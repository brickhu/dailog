// 最小 chrome.runtime 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  runtime: {
    onMessage: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
    sendMessage: (message: unknown) => Promise<unknown>;
  };
};

import {
  MSG_COLLECT, MSG_CACHE_COLLECT, MSG_LIST_COLLECTS, MSG_GET_RULES, MSG_COLLECTS_CHANGED, conversationKey,
  type CollectedDialogue, type CacheCollectResult, type ListCollectsResult, type CollectSummary,
  type GetRulesResult, type CollectRules, type Platform,
} from "./shared";
import { collectFromDocument, resolvePlatform } from "./content/collector";
import { parseDeepSeekPage } from "./content/deepseek";
import { parseClaudePage } from "./content/claude";
import { parseDoubaoPage } from "./content/doubao";
import { waitForMutation } from "./content/mutation";
import { createFab, type FabController } from "./content/ui";
import { isConversationPage } from "./content/conversation-page";
import { applyRuleFallback } from "./content/read-fallback";
import { highlightNodes, clearHighlight } from "./content/highlight";
import { collectScrollContainers } from "./content/scroll-container";
import { showCollectOverlay, hideCollectOverlay } from "./content/collect-overlay";
import { renderSelects, refreshSelects, selectedNodes, clearSelects } from "./content/message-select";
import type { MessageNode } from "./content/core";

/** 平台消息读取：本地专有解析器优先（打印撑开/滚动下全量提取）；
 *  本地选择器失配（站点 DOM 改版）→ 远程规则选择器同一文档兜底提取，
 *  避免掉到整页文本兜底（含导航噪音）。platform 缺省 = 按规则解析当前 URL（规则平台） */
async function readPlatformMessages(
  platform: Platform | null,
  parseLocal: (root: ParentNode) => MessageNode[],
): Promise<MessageNode[]> {
  const local = parseLocal(document);
  if (local.length > 0) return local;
  const rules = await getRules();
  const p = platform ?? resolvePlatform(rules, location.href);
  return applyRuleFallback(local, p ? rules?.platforms[p] : null, document);
}

/** 滚动采集进度高亮回调（所有平台通用；幂等，重复读取无副作用） */
const highlightProgress = (nodes: MessageNode[]): void => highlightNodes(nodes);

/** 候选滚动容器（全集：专有 + 祖先链 + Virtuoso + 页面级——受控虚拟列表
 *  可能重置单一容器 scrollTop，sweep 对全部候选滚动） */
const scrollContainers = (hints?: string[]): HTMLElement[] => {
  const all = collectScrollContainers(document, hints);
  return all.length > 0 ? all : [document.scrollingElement as HTMLElement].filter(Boolean);
};

function deepSeekScroll() {
  const containers = scrollContainers([".ds-scroll-area"]);
  if (containers.length === 0) return undefined;
  return {
    container: containers[0],
    containers,
    readNodes: () => readPlatformMessages("deepseek", parseDeepSeekPage),
    waitForMutation: () => waitForMutation(document.body),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(containers[0]),
  };
}

/** 采集结束清理：清除滚动进度高亮，页面恢复原样 */
function restoreContainer(_container: HTMLElement): void {
  clearHighlight();
}

/** claude 长对话：滚动扫描采集（统一采集方式，与其它平台一致） */
function claudeScroll() {
  const containers = scrollContainers();
  if (containers.length === 0) return undefined;
  return {
    container: containers[0],
    containers,
    readNodes: () => readPlatformMessages("claude", parseClaudePage),
    waitForMutation: () => waitForMutation(document.body),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(containers[0]),
  };
}

/** chatgpt 等无专有解析器的平台：滚动采集用规则选择器提取
 *  （本地解析器恒空 → readPlatformMessages 走规则兜底——platform 缺省按 URL 解析，
 *  滚动扫描下逐批提取完整消息） */
function ruleOnlyScroll() {
  const containers = scrollContainers();
  if (containers.length === 0) return undefined;
  return {
    container: containers[0],
    containers,
    readNodes: () => readPlatformMessages(null, () => [] as MessageNode[]),
    waitForMutation: () => waitForMutation(document.body),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(containers[0]),
  };
}

/** 当前页的滚动采集配置：按 hostname 分发平台采集器
 *  （deepseek/claude/doubao 专有解析器优先；其余平台规则提取滚动——chatgpt 长对话
 *  虚拟列表必须滚动/打印采集，纯静态解析只拿得到视口内消息） */
function pageScroll() {
  switch (location.hostname) {
    case "chat.deepseek.com":
      return deepSeekScroll();
    case "claude.ai":
      return claudeScroll();
    case "www.doubao.com":
      return doubaoScroll();
    default:
      return ruleOnlyScroll();
  }
}

/** doubao 滚动采集（本地解析器） */
function doubaoScroll() {
  const containers = scrollContainers();
  if (containers.length === 0) return undefined;
  return {
    container: containers[0],
    containers,
    readNodes: () => readPlatformMessages("doubao", parseDoubaoPage),
    waitForMutation: () => waitForMutation(document.body),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(containers[0]),
  };
}

// ============ AI 对话页：采集 FAB + 「已采集」状态 ============

/** 读取扩展缓存中的待入库条目（按 appBase 按域过滤——不传 = 扩展当前生效基址；
 *  扩展上下文失效时返回空） */
async function listPending(appBase?: string): Promise<CollectSummary[]> {
  try {
    const res = (await chrome.runtime.sendMessage({
      type: MSG_LIST_COLLECTS,
      ...(appBase ? { appBase } : {}),
    })) as ListCollectsResult;
    return res?.ok ? res.items : [];
  } catch {
    return [];
  }
}

// ---- AI 对话页：采集 FAB + 「已采集」状态 ----

// SPA 导航监听（claude.ai 首页 → 对话页是前端跳转，页面不刷新、content script 不重跑），
// popstate + 轮询双保险（SPA 框架未必触发 popstate）
function watchUrl(onChange: (url: string) => void): void {
  let last = location.href;
  const check = () => {
    if (location.href === last) return;
    last = location.href;
    onChange(last);
  };
  window.addEventListener("popstate", check);
  setInterval(check, 800);
}

/** 拉取远程抓取规则（background 侧 TTL 缓存；扩展上下文失效时返回 null） */
async function getRules(): Promise<CollectRules | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: MSG_GET_RULES })) as GetRulesResult;
    return res?.ok ? res.rules : null;
  } catch {
    return null;
  }
}

/** 本页采集：统一滚动扫描 + 远程规则兜底（onCollected 回调带 el 的最终节点集，
 *  确认态勾选框用） */
async function collectPage(): Promise<CollectedDialogue | null> {
  return collectFromDocument({
    root: document,
    url: location.href,
    scroll: pageScroll(),
    getRules,
    onCollected: (nodes) => { collectedNodes = nodes; },
  });
}

// 采集确认态状态（content script 单页单 FAB）：采集完成停留页面，
// 用户勾选调整后确认导入——不自动跳转 studio
let confirmMode = false;
let collectedNodes: MessageNode[] = [];
let pendingDialogue: CollectedDialogue | null = null;
/** 确认态勾选框重建定时器（虚拟列表渲染会回收选框） */
let selectRefreshTimer: ReturnType<typeof setInterval> | undefined;

// 模块级：FAB「已采集」状态刷新入口（initConversationFab 内赋值；
// background 缓存变化广播时调用——立即恢复「采集对话」，无需等轮询）
let refreshCollectedState: (() => void) | undefined;

function initConversationFab(): void {
  const fab: FabController = createFab({
    onClick: () => {
      if (confirmMode) {
        // 确认导入：按勾选过滤消息 → 缓存（background 自动打开 studio/import）
        const selected = selectedNodes(collectedNodes);
        if (selected.length === 0) {
          fab.showToast("未选择任何消息", "error");
          return;
        }
        const dialogue: CollectedDialogue = {
          ...pendingDialogue!,
          messages: selected.map(({ role, content }) => ({ role, content })),
        };
        exitConfirm(fab);
        void cacheDialogue(dialogue, fab);
        return;
      }
      fab.setBusy(true);
      // 整页蒙层：禁用鼠标点击/滚动，防止用户操作干扰滚动扫描
      showCollectOverlay();
      void (async () => {
        try {
          const dialogue = await collectPage();
          if (!dialogue) {
            fab.showToast("未识别到对话内容，请确认当前是对话页", "error");
            return;
          }
          // 采集完成校验提示：重复内容已去重 / 滚动未到底可能未采全
          if (dialogue.duplicatesRemoved) fab.showToast(`已去除 ${dialogue.duplicatesRemoved} 条重复内容`, "success");
          if (dialogue.incomplete) fab.showToast("对话过长可能未采全，建议分次采集", "error");
          if (dialogue.lowConfidence || collectedNodes.length === 0) {
            // 整页文本兜底/无节点可勾选：维持自动流程（直接缓存 + 打开导入页）
            await cacheDialogue(dialogue, fab);
            return;
          }
          // 进入确认态：勾选框 + FAB「确认导入」+「放弃」
          confirmMode = true;
          pendingDialogue = dialogue;
          renderSelects(collectedNodes);
          // 虚拟列表（chatgpt 等）渲染会重建消息 DOM 导致勾选框被回收——
          // 定期重建丢失的选框并保留勾选状态
          selectRefreshTimer = setInterval(() => refreshSelects(collectedNodes), 1500);
          fab.setConfirm(true, () => {
            exitConfirm(fab);
            fab.showToast("已取消采集", "success");
          });
          fab.showToast(`已采集 ${collectedNodes.length} 条，取消勾选可剔除，点击确认导入`, "success");
        } catch (e) {
          fab.showToast(`采集失败：${e instanceof Error ? e.message : e}`, "error");
        } finally {
          fab.setBusy(false);
          hideCollectOverlay();
        }
      })();
    },
  });

  /** 退出确认态：清除勾选框、状态与 FAB 恢复 */
  function exitConfirm(fabRef: FabController): void {
    confirmMode = false;
    pendingDialogue = null;
    collectedNodes = [];
    if (selectRefreshTimer) clearInterval(selectRefreshTimer);
    selectRefreshTimer = undefined;
    clearSelects();
    fabRef.setConfirm(false);
    void updateCollectedState();
  }

  /** 缓存采集结果（background 自动打开确认入库页；同会话重采集自动替换旧条目） */
  async function cacheDialogue(dialogue: CollectedDialogue, fabRef: FabController): Promise<void> {
    const res = (await chrome.runtime.sendMessage({
      type: MSG_CACHE_COLLECT,
      dialogue,
    })) as CacheCollectResult;
    fabRef.showToast(
      res.ok ? "已采集 ✓ 请在打开的页面确认入库" : `采集失败：${res.error ?? "未知错误"}`,
      res.ok ? "success" : "error",
    );
  }

  /** 当前对话是否已在缓存中 → 按钮切「已采集 ↻」（跨标签页采集也靠轮询感知） */
  async function updateCollectedState(): Promise<void> {
    const key = conversationKey(location.href);
    fab.setCollected((await listPending()).some((i) => conversationKey(i.url) === key));
  }
  refreshCollectedState = () => void updateCollectedState();

  // 对话页判定通用化（URL 启发式 + DOM 对话框兜底）——完全同步，不依赖远程规则；
  // SPA 导航后 watchUrl 轮询重判（DOM 已更新，对话框检测随之生效）
  const applyVisibility = (url: string) => fab.setVisible(isConversationPage(url, document));
  applyVisibility(location.href);

  // 非对话页（首页等）隐藏按钮；SPA 导航进入对话页后自动显示
  void updateCollectedState();
  watchUrl((url) => {
    applyVisibility(url);
    void updateCollectedState();
  });
  setInterval(() => void updateCollectedState(), 3000);
  // 定期重判显隐（兜底：SPA/DOM 延迟渲染——初始判定时输入框可能未渲染，
  // URL 未变则不触发 watchUrl，靠此定期补判）
  setInterval(() => applyVisibility(location.href), 2000);
}

// AI 平台页：采集 FAB（studio 域不再注入 content script——待入库提醒已移除）。
// 初始化包保护：真实页面异常时 Console 输出 [dailog] 错误（可诊断），不静默失败
try {
  initConversationFab();
} catch (e) {
  console.error("[dailog] FAB 初始化失败：", e);
}

// 消息监听：popup「采集当前对话」触发本页采集（返回 dialogue，由 popup 转 background 缓存）；
// background 缓存变化广播 → 立即刷新 FAB「已采集」状态（删除/新增后无需等 3 秒轮询）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === MSG_COLLECTS_CHANGED) {
    // 广播通知无需响应；updateCollectedState 在 initConversationFab 闭包内——
    // 通过重新触发 listPending 轮询逻辑：直接调用对话页状态刷新
    void refreshCollectedState?.();
    return;
  }
  if (msg?.type !== MSG_COLLECT) return;
  collectPage()
    .then((dialogue) => {
      const result: { ok: boolean; dialogue?: CollectedDialogue; error?: string } = dialogue
        ? { ok: true, dialogue }
        : { ok: false, error: "collect_empty" };
      sendResponse(result);
    })
    .catch((e) => sendResponse({ ok: false, error: String(e instanceof Error ? e.message : e) }));
  return true; // 异步响应
});
