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
import { waitForMutation } from "./content/mutation";
import { createFab, type FabController } from "./content/ui";
import { isConversationPage } from "./content/conversation-page";
import { applyRuleFallback } from "./content/read-fallback";
import { highlightNodes, clearHighlight } from "./content/highlight";
import { runCollectFlow } from "./content/collect-flow";
import { applyPrintCss } from "./content/print-css";
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

function deepSeekScroll() {
  // 专有容器类名失效（DOM 改版）→ 泛化探测兜底（页面级滚动保底），
  // 提取器始终用 deepseek 平台（不跨平台套用 claude 选择器）
  const container = document.querySelector<HTMLElement>(".ds-scroll-area") ?? findScrollContainer();
  if (!container) return undefined;
  return {
    container,
    readNodes: () => readPlatformMessages("deepseek", parseDeepSeekPage),
    waitForMutation: () => waitForMutation(document.body),
    expand: makeExpand(container, () => readPlatformMessages("deepseek", parseDeepSeekPage)),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(container),
  };
}

/** 找消息区域向上第一个可滚动容器（泛化：任一平台消息标记起步；
 *  无固定容器类名时探测。claude/chatgpt 长对话滚动加载历史用）。
 *  注意：虚拟列表容器 scrollHeight≈clientHeight（只渲染视口窗口），
 *  不能要求有滚动余量——只要 overflow 可滚就认 */
function findScrollContainer(): HTMLElement | null {
  const first = document.querySelector(
    "[data-testid='user-message'], [data-testid='assistant-message'], [data-message-author-role], .ds-message",
  );
  let el: HTMLElement | null = (first?.parentElement as HTMLElement | null) ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return el;
    el = el.parentElement;
  }
  // 兜底：页面级滚动
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** 打印式撑开：高度撑开 + 模拟打印样式（claude 等站点的 @media print 规则会展开虚拟列表，
 *  全量渲染消息——等效打印预览但不需要弹打印对话框）。
 *  返回是否撑开成功（节点显著增多 ≥2 条，过滤流式/渲染噪音）；失败由调用方还原后走滚动循环 */
function makeExpand(container: HTMLElement, readNodes: () => Promise<MessageNode[]>): () => Promise<boolean> {
  return async () => {
    const before = (await readNodes()).length;
    container.style.height = "auto";
    container.style.maxHeight = "none";
    container.style.overflow = "visible";
    applyPrintCss(document);
    // 全量渲染可能是逐批插入：多等几轮 mutation
    for (let i = 0; i < 3; i++) await waitForMutation(document.body);
    const after = (await readNodes()).length;
    return after > before + 2;
  };
}

function restoreContainer(container: HTMLElement): void {
  container.style.height = "";
  container.style.maxHeight = "";
  container.style.overflow = "";
  // 移除模拟打印样式（虚拟列表随之还原）
  document.querySelectorAll<HTMLElement>("style[data-dailog-print]").forEach((el) => el.remove());
  // 采集结束：清除滚动进度高亮，页面恢复原样
  clearHighlight();
}

/** claude 长对话懒加载：先试打印式撑开（虚拟列表全量渲染），失败则滚动到顶循环补全历史 */
function claudeScroll() {
  const container = findScrollContainer();
  if (!container) return undefined;
  return {
    container,
    readNodes: () => readPlatformMessages("claude", parseClaudePage),
    waitForMutation: () => waitForMutation(document.body),
    expand: makeExpand(container, () => readPlatformMessages("claude", parseClaudePage)),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(container),
  };
}

/** chatgpt 等无专有解析器的平台：滚动/打印采集用规则选择器提取
 *  （本地解析器恒空 → readPlatformMessages 走规则兜底——platform 缺省按 URL 解析，
 *  打印全量渲染/滚动循环下逐批提取完整消息） */
function ruleOnlyScroll() {
  const container = findScrollContainer();
  if (!container) return undefined;
  return {
    container,
    readNodes: () => readPlatformMessages(null, () => [] as MessageNode[]),
    waitForMutation: () => waitForMutation(document.body),
    expand: makeExpand(container, () => readPlatformMessages(null, () => [] as MessageNode[])),
    onNodesRead: highlightProgress,
    restore: () => restoreContainer(container),
  };
}

/** 当前页的滚动采集配置：按 hostname 分发平台采集器
 *  （deepseek/claude 专有解析器优先；其余平台规则提取滚动——chatgpt 长对话
 *  虚拟列表必须滚动/打印采集，纯静态解析只拿得到视口内消息） */
function pageScroll() {
  switch (location.hostname) {
    case "chat.deepseek.com":
      return deepSeekScroll();
    case "claude.ai":
      return claudeScroll();
    default:
      return ruleOnlyScroll();
  }
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

/** 本页采集：本地解析（滚动 / 打印媒体模拟 / 远程规则兜底）。
 *  打印媒体模拟在 MAIN world 的 matchMedia 覆盖 + ISOLATED world 的 CSSOM 打印规则提取，
 *  零额外权限（过审友好），与真实打印预览等效触发站点全量渲染 */
async function collectPage(): Promise<CollectedDialogue | null> {
  return collectFromDocument({ root: document, url: location.href, scroll: pageScroll(), getRules });
}

// 模块级：FAB「已采集」状态刷新入口（initConversationFab 内赋值；
// background 缓存变化广播时调用——立即恢复「采集对话」，无需等轮询）
let refreshCollectedState: (() => void) | undefined;

function initConversationFab(): void {
  const fab: FabController = createFab({
    onClick: () => {
      fab.setBusy(true);
      // 采集 → 本地缓存（background 自动打开确认入库页；同会话重采集自动替换旧条目）。
      // 不校验登录/频道——鉴权是 app 的 auth provider 在入库时的事
      void runCollectFlow({
        collect: collectPage,
        cache: async (dialogue) =>
          (await chrome.runtime.sendMessage({
            type: MSG_CACHE_COLLECT,
            dialogue,
          })) as CacheCollectResult,
        onResult: (text, kind) => fab.showToast(text, kind),
      }).finally(() => fab.setBusy(false));
    },
  });

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
}

// AI 平台页：采集 FAB（studio 域不再注入 content script——待入库提醒已移除）
initConversationFab();

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
