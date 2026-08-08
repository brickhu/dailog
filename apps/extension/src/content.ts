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
import { collectFromDocument, resolvePlatform, buildManualDialogue } from "./content/collector";
import { parseDeepSeekPage } from "./content/deepseek";
import { parseClaudePage } from "./content/claude";
import { parseDoubaoPage } from "./content/doubao";
import { createFab, type FabController } from "./content/ui";
import { isConversationPage } from "./content/conversation-page";
import { applyRuleFallback, applyRuleMerge } from "./content/read-fallback";
import { showCollectHint, hideCollectHint, showScanline, hideScanline } from "./content/collect-hint";
import { renderUnitBoxes, clearUnitBoxes } from "./content/unit-boxes";
import { groupIntoUnits, isCompleteUnit, unitRect, scanCrossing, messageKey, mergeUnitMembers, type MessageNode, type QaUnit } from "./content/core";

/** 平台消息读取：本地专有解析器优先（用户滚动驱动渲染，轮询读当前渲染出的消息）；
 *  本地为空（站点 DOM 改版）→ 远程规则选择器兜底；本地缺助手回复（claude 旧
 *  选择器只匹配 user）→ 规则提取补齐合并。platform 缺省 = 按规则解析当前 URL */
async function readPlatformMessages(
  platform: Platform | null,
  parseLocal: (root: ParentNode) => MessageNode[],
): Promise<MessageNode[]> {
  const local = parseLocal(document);
  if (local.length === 0) {
    const rules = await getRules();
    const p = platform ?? resolvePlatform(rules, location.href);
    return applyRuleFallback(local, p ? rules?.platforms[p] : null, document);
  }
  if (local.some((n) => n.role === "assistant")) return local;
  const rules = await getRules();
  const p = platform ?? resolvePlatform(rules, location.href);
  return applyRuleMerge(local, p ? rules?.platforms[p] : null, document);
}

/** 当前页的平台消息读取器（按 hostname 分发：专有解析器优先，其余规则兜底——
 *  chatgpt 等规则平台本地解析器恒空，readPlatformMessages 内部走规则提取） */
function pageReadNodes(): (() => Promise<MessageNode[]>) | undefined {
  switch (location.hostname) {
    case "chat.deepseek.com":
      return () => readPlatformMessages("deepseek", parseDeepSeekPage);
    case "claude.ai":
      return () => readPlatformMessages("claude", parseClaudePage);
    case "www.doubao.com":
      return () => readPlatformMessages("doubao", parseDoubaoPage);
    default:
      return () => readPlatformMessages(null, () => [] as MessageNode[]);
  }
}

// ============ AI 对话页：采集 FAB + 手动采集状态机 ============

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

/** 本页静态采集（popup「采集当前对话」触发；交互式长对话走手动采集状态机） */
async function collectPage(): Promise<CollectedDialogue | null> {
  return collectFromDocument({ root: document, url: location.href, getRules });
}

// 扫码线采集状态（用户滚动驱动渲染，扩展只做观察——中线固定，内容上移，
// 问答单元底边扫过中线即选中入库，向下滚回中线以下取消）：
// 采集态（monitoring）→ 提示条 + 扫码线 + FAB「完成 (N)」+ 放弃；完成 → 确认态（confirmMode）
let monitoring = false;
let rangeUnits: QaUnit[] = [];
/** 各单元最近一次渲染的底线 Y（扫码线穿越判定用；起点重置） */
const lastBottoms = new Map<string, number>();
let monitorIv: ReturnType<typeof setInterval> | undefined;
let monitorUrl = "";
let monitorReadNodes: (() => Promise<MessageNode[]>) | undefined;
let confirmMode = false;
let pendingDialogue: CollectedDialogue | null = null;

// 模块级：FAB「已采集」状态刷新入口（initConversationFab 内赋值；
// background 缓存变化广播时调用——立即恢复「采集对话」，无需等轮询）
let refreshCollectedState: (() => void) | undefined;

function initConversationFab(): void {
  const fab: FabController = createFab({
    onClick: () => {
      if (monitoring) {
        // 监测中点击 FAB = 完成采集（进入确认态）
        void finishMonitorCollect();
        return;
      }
      if (confirmMode) {
        // 确认态点 FAB = 确认导入（放弃走 FAB 上方「放弃」小按钮）
        void confirmImport();
        return;
      }
      startMonitorCollect();
    },
  });

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

  /** 开始扫码线采集：滚动锁定到底部 → 提示条 + 扫码线 + FAB「完成 (N)」+ 轮询 */
  function startMonitorCollect(): void {
    const readNodes = pageReadNodes();
    if (!readNodes) {
      fab.showToast("未识别到对话内容，请确认当前是对话页", "error");
      return;
    }
    monitoring = true;
    rangeUnits = [];
    lastBottoms.clear();
    monitorUrl = location.href;
    monitorReadNodes = readNodes;
    showCollectHint();
    showScanline();
    fab.setCollecting(0, { onAbandon: () => cancelMonitorCollect() });
    fab.showToast("已开始采集：向上滚动扫描，扫过中线即选中", "success");
    // 滚动锁定到底部（虚拟列表初始即底部；全文渲染页面滚到最新消息）
    void readNodes().then((init) => {
      const last = init[init.length - 1]?.el;
      if (last) {
        try {
          last.scrollIntoView({ block: "end", behavior: "instant" as ScrollBehavior });
        } catch {
          try {
            last.scrollIntoView();
          } catch {
            // 无 scrollIntoView 环境静默
          }
        }
      }
      // 锁定稳定后：完整协调一次 + 默认选中最后一个完整问答单元（最新一轮问答；
      // 末尾光有问没答的不算单元；保证计数从 1 起步）
      setTimeout(() => {
        if (!monitoring) return;
        void (async () => {
          await tickMonitor();
          if (!monitoring || !monitorReadNodes) return;
          const bottom = await monitorReadNodes();
          if (!monitoring) return;
          const lastComplete = groupIntoUnits(bottom).filter(isCompleteUnit).pop();
          if (lastComplete && !rangeUnits.some((u) => u.id === lastComplete.id)) {
            rangeUnits.push(lastComplete);
            lastBottoms.set(lastComplete.id, unitRect(lastComplete).bottom);
            fab.updateCollectCount(rangeUnits.length);
          }
        })();
      }, 200);
    });
    // 滚动事件驱动即时读取（用户滚动快于 300ms 轮询时，窗口间隙不丢消息）；
    // 滚动停止后补读一次（虚拟列表先渲染骨架后渲染内容，稳定后内容才完整）
    document.addEventListener("scroll", onUserScroll, { capture: true, passive: true });
    void tickMonitor();
    monitorIv = setInterval(() => void tickMonitor(), 300);
  }

  let scrollDebounce: ReturnType<typeof setTimeout> | undefined;
  let tickRunning = false;

  /** 滚动触发：即时读一次 + 150ms 停止后补读（等骨架渲染完内容） */
  function onUserScroll(): void {
    void tickMonitor();
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => void tickMonitor(), 150);
  }

  /** 单轮协调：读当前渲染消息 → 分组问答单元 → 底线相对中线的方向穿越判定
   *  （往上滚底线 < 中线 → > 中线 = 追加；往下滚 > 中线 → < 中线 = 移出）→
   *  选区框渲染 */
  async function tickMonitor(): Promise<void> {
    if (!monitoring || !monitorReadNodes || tickRunning) return;
    if (location.href !== monitorUrl) {
      // SPA 导航跳走：自动取消本次采集
      cancelMonitorCollect();
      return;
    }
    if (document.hidden) return; // 后台标签页跳过（回来继续）
    tickRunning = true;
    try {
      const nodes = await monitorReadNodes();
      if (!monitoring) return; // await 期间被放弃/完成
      const centerY = window.innerHeight / 2;
      const units = groupIntoUnits(nodes);
      let changed = false;
      for (const unit of units) {
        const { bottom } = unitRect(unit);
        const prev = lastBottoms.get(unit.id);
        lastBottoms.set(unit.id, bottom);
        const crossing = scanCrossing(prev, bottom, centerY);
        const idx = rangeUnits.findIndex((u) => u.id === unit.id);
        if (idx >= 0) {
          // 已选单元：合并成员（稳定键去重、内容只增不减——窗口切分读到局部
          // 时合并不替换，已选内容不丢）→ 底线向下穿越中线（往下滚）→ 移出
          mergeUnitMembers(rangeUnits[idx], unit);
          if (crossing === "remove") {
            rangeUnits.splice(idx, 1);
            changed = true;
          }
        } else if (crossing === "add" && unit.messages[0]?.role === "user" && isCompleteUnit(unit)) {
          // 完整问答单元（有问有答）底线跨过中线 → 追加到数组（必入数组）
          rangeUnits.push(unit);
          changed = true;
        } else if (unit.messages[0]?.role === "assistant") {
          // assistant 片段（窗口切分）：匹配数组内所属单元——合并成员刷新内容，
          // 底线向下穿越中线则移出父单元
          const key = messageKey(unit.messages[0]);
          const parent = rangeUnits.find((u) => u.messages.some((m) => messageKey(m) === key));
          if (parent) {
            mergeUnitMembers(parent, unit);
            if (crossing === "remove") {
              rangeUnits.splice(rangeUnits.indexOf(parent), 1);
              changed = true;
            }
          }
        }
      }
      // 选区框渲染（问答单元容器 outline，替代消息级 outline）
      renderUnitBoxes(rangeUnits);
      if (changed) fab.updateCollectCount(rangeUnits.length); // 问答单元数
    } catch {
      // 单轮读取失败忽略，下一轮重试
    } finally {
      tickRunning = false;
    }
  }

  /** 放弃采集（放弃按钮 / SPA 跳走）：清理状态与 UI */
  function cancelMonitorCollect(): void {
    stopMonitorLoop();
    monitoring = false;
    hideCollectHint();
    hideScanline();
    clearUnitBoxes();
    fab.showToast("已取消采集", "success");
    void updateCollectedState();
  }

  function stopMonitorLoop(): void {
    if (monitorIv) {
      clearInterval(monitorIv);
      monitorIv = undefined;
    }
    if (scrollDebounce) {
      clearTimeout(scrollDebounce);
      scrollDebounce = undefined;
    }
    document.removeEventListener("scroll", onUserScroll, { capture: true, passive: true } as EventListenerOptions);
  }

  /** 完成采集：组装对话 → 进入确认态（FAB「确认导入 (N 个问答)」+ 放弃） */
  async function finishMonitorCollect(): Promise<void> {
    stopMonitorLoop();
    monitoring = false;
    hideCollectHint();
    hideScanline();
    clearUnitBoxes();
    const unitCount = rangeUnits.length;
    const nodes = rangeUnits.flatMap((u) => u.messages);
    try {
      const dialogue = await buildManualDialogue({ root: document, url: location.href, getRules }, nodes);
      if (!dialogue) {
        fab.showToast("未识别到对话内容，请确认已滚动浏览完整对话", "error");
        void updateCollectedState();
        return;
      }
      confirmMode = true;
      pendingDialogue = dialogue;
      fab.setConfirm(true, unitCount, () => {
        confirmMode = false;
        pendingDialogue = null;
        fab.showToast("已取消采集", "success");
        void updateCollectedState();
      });
      fab.showToast(`已采集 ${unitCount} 个问答单元，点击「确认导入」入库`, "success");
    } catch (e) {
      fab.showToast(`采集失败：${e instanceof Error ? e.message : e}`, "error");
      void updateCollectedState();
    }
  }

  /** 确认导入：缓存结果（background 自动开导入页），FAB 恢复「已采集」 */
  async function confirmImport(): Promise<void> {
    const dialogue = pendingDialogue;
    confirmMode = false;
    pendingDialogue = null;
    if (!dialogue) return;
    fab.setBusy(true);
    try {
      await cacheDialogue(dialogue, fab);
    } finally {
      fab.setBusy(false);
      void updateCollectedState();
    }
  }

  /** 当前对话是否已在缓存中 → 按钮切「已采集 ↻」（跨标签页采集也靠轮询感知）；
   *  采集/确认进行中不刷新（避免打断 FAB 采集态/确认态） */
  async function updateCollectedState(): Promise<void> {
    if (monitoring || confirmMode) return;
    const key = conversationKey(location.href);
    fab.setCollected((await listPending()).some((i) => conversationKey(i.url) === key));
  }
  refreshCollectedState = () => void updateCollectedState();

  // 对话页判定通用化（URL 启发式 + DOM 对话框兜底）——完全同步，不依赖远程规则；
  // SPA 导航后 watchUrl 轮询重判（DOM 已更新，对话框检测随之生效）。
  // 采集/确认进行中不隐藏（「完成/确认导入」按钮必须可用）
  const applyVisibility = (url: string) => {
    if (!monitoring && !confirmMode) fab.setVisible(isConversationPage(url, document));
  };
  applyVisibility(location.href);

  // 非对话页（首页等）隐藏按钮；SPA 导航进入对话页后自动显示
  void updateCollectedState();
  watchUrl((url) => {
    // 监测采集进行中 SPA 跳走 → 自动取消（tickMonitor 也会兜底检测）
    if (monitoring && url !== monitorUrl) cancelMonitorCollect();
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

// 消息监听：popup「采集当前对话」触发本页静态采集（返回 dialogue，由 popup 转 background 缓存）；
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
