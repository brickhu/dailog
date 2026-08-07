// 最小 chrome.runtime 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  runtime: {
    onMessage: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
    sendMessage: (message: unknown) => Promise<unknown>;
    /** CDP 滚动期间保持 service worker 存活（open port 是可靠的保活手段） */
    connect: (opts: { name: string }) => { disconnect: () => void };
  };
};

import {
  MSG_COLLECT, MSG_CACHE_COLLECT, MSG_LIST_COLLECTS, MSG_GET_RULES, MSG_COLLECTS_CHANGED, MSG_CDP_SCROLL_START, MSG_CDP_SCROLL_STOP, conversationKey,
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
import { showCollectHint, hideCollectHint, updateCollectHint } from "./content/collect-hint";
import { findScrollContainer } from "./content/scroll-driver";
import { highlightNodes, clearHighlight } from "./content/highlight";
import { mergeMessageNodes, type MessageNode } from "./content/core";

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

// 监测采集状态（CDP 真实滚轮驱动滚动，扩展只做观察——轮询读当前渲染出的消息并暂存）：
// 采集态（monitoring）→ CDP 自动滚动 + FAB「完成 (N)」+ 放弃；完成 → 确认态（confirmMode）
let monitoring = false;
let monitorNodes: MessageNode[] = [];
let monitorIv: ReturnType<typeof setInterval> | undefined;
let monitorUrl = "";
let monitorReadNodes: (() => Promise<MessageNode[]>) | undefined;
let cdpWatchIv: ReturnType<typeof setInterval> | undefined;
let cdpKeepalive: { disconnect: () => void } | undefined;
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

  /** 开始监测采集：滚动锁定到底部 → 提示条 + FAB「完成 (N)」+ 自动匀速滚动驱动 + 轮询暂存 */
  function startMonitorCollect(): void {
    const readNodes = pageReadNodes();
    if (!readNodes) {
      fab.showToast("未识别到对话内容，请确认当前是对话页", "error");
      return;
    }
    monitoring = true;
    monitorNodes = [];
    monitorUrl = location.href;
    monitorReadNodes = readNodes;
    showCollectHint();
    fab.setCollecting(0, { onAbandon: () => cancelMonitorCollect() });
    fab.showToast("已开始采集：自动向上滚动，可随时点「完成」", "success");
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
      if (!monitoring || init.length === 0) return;
      // 等底部滚动稳定后启动 CDP 真实滚轮驱动（模拟用户鼠标向上滚动；
      // 滚不动自动降级为手动，到顶自动完成）
      setTimeout(() => {
        if (!monitoring) return;
        void startCdpDriver(findScrollContainer(document, init[0]?.el));
      }, 400);
    });
    // 滚动事件驱动即时读取（用户滚动快于 300ms 轮询时，窗口间隙不丢消息）；
    // 滚动停止后补读一次（虚拟列表先渲染骨架后渲染内容，稳定后内容才完整）
    document.addEventListener("scroll", onUserScroll, { capture: true, passive: true });
    void tickMonitor();
    monitorIv = setInterval(() => void tickMonitor(), 300);
  }

  /** CDP 真实滚轮驱动：background attach debugger 后按固定节奏向消息区派发
   *  mouseWheel（isTrusted=true，浏览器层面即用户滚轮——虚拟列表必须响应）。
   *  滚轮落点优先取中间消息元素中心（避开容器间隙/侧栏）；到顶判定用
   *  「首条消息到达容器顶部」容器相对坐标（底部窗口首条 rect.top 也是正的，
   *  视口绝对坐标会误判到顶）。每 300ms 双信号监测进展（内容计数 / 容器位置），
   *  连续无进展 → 换备选落点重试一次 → 仍不行降级手动 */
  async function startCdpDriver(container: HTMLElement | null, pointIndex = 0): Promise<void> {
    if (!monitoring) return;
    // 候选落点：中间消息元素中心 → 容器中心 → 视口 30%/70% 高度（重试换点用）
    const rect = container?.getBoundingClientRect();
    const read = await monitorReadNodes!();
    const midMsg = read[Math.floor(read.length / 2)]?.el;
    const midRect = midMsg?.getBoundingClientRect();
    const points: Array<{ x: number; y: number }> = [];
    const push = (x: number, y: number): void => {
      const cx = Math.max(40, Math.min(Math.round(x), window.innerWidth - 40));
      const cy = Math.max(80, Math.min(Math.round(y), window.innerHeight - 80));
      if (!points.some((p) => Math.abs(p.x - cx) < 8 && Math.abs(p.y - cy) < 8)) points.push({ x: cx, y: cy });
    };
    if (midRect && midRect.width >= 100 && midRect.height >= 30) {
      push(midRect.left + midRect.width / 2, midRect.top + Math.min(midRect.height / 2, 300));
    }
    if (rect && rect.width >= 200 && rect.height >= 200) {
      push(rect.left + rect.width / 2, rect.top + rect.height / 2);
    }
    push(window.innerWidth / 2, window.innerHeight * 0.3);
    push(window.innerWidth / 2, window.innerHeight * 0.7);
    const point = points[Math.min(pointIndex, points.length - 1)];
    if (!point) {
      updateCollectHint("自动滚动不可用，请手动滚动浏览完整对话；完成后点「完成」");
      return;
    }
    let res: { ok: boolean; error?: string };
    try {
      res = (await chrome.runtime.sendMessage({
        type: MSG_CDP_SCROLL_START,
        x: point.x,
        y: point.y,
        deltaY: -36, // 负 = 向上滚动（≈1500px/s @ 24ms 间隔）
        intervalMs: 24,
      })) as { ok: boolean; error?: string };
    } catch {
      res = { ok: false, error: "context_invalid" };
    }
    if (!res.ok) {
      updateCollectHint("自动滚动不可用（调试器冲突），请手动滚动浏览完整对话；完成后点「完成」");
      return;
    }
    console.info(`[dailog] cdp-driver start point=(${point.x},${point.y}) idx=${pointIndex} container=${container ? `${container.tagName}.${container.className}` : "null"}`);
    // 保活：open port 保持 service worker 存活（interval 不保证存活）
    try {
      cdpKeepalive = chrome.runtime.connect({ name: "dailog-cdp-scroll" });
    } catch {
      // 无 connect 环境（测试）静默
    }
    // 双信号进展监测（300ms 一次）：内容计数增长（虚拟列表渲染出新窗口）或
    // 容器位置前进（全文渲染页滚动）任一即算进展；连续 ~2s 无进展 →
    // 首条消息到达容器顶部 = 到顶自动完成，否则换点重试/降级手动
    let lastPos = container?.scrollTop ?? -1;
    let stallMs = 0;
    let ticks = 0;
    cdpWatchIv = setInterval(() => {
      void (async () => {
        if (!monitoring) return;
        const pos = container?.scrollTop ?? -1;
        const before = monitorNodes.length;
        await tickMonitor(); // 幂等合并（滚动事件也会触发，此处兜底）
        const progressed = monitorNodes.length > before || (container ? pos < lastPos - 2 : false);
        lastPos = pos;
        if (progressed) {
          stallMs = 0;
          return;
        }
        stallMs += 300;
        ticks += 1;
        // 诊断日志：每 5 轮输出一次状态（定位滚动未达消息区等场景）
        if (ticks % 5 === 0) {
          console.info(`[dailog] cdp-driver stall count=${monitorNodes.length} scrollTop=${pos} point=(${point.x},${point.y})`);
        }
        if (stallMs < 2000) return;
        stopCdpDriver();
        // 到顶判定（容器相对坐标）：首条已渲染消息已到容器顶部边缘；
        // 容器不可靠时退回视口绝对坐标（≤40px）
        const first = (await monitorReadNodes?.())?.[0];
        const firstTop = first?.el ? first.el.getBoundingClientRect().top : -1;
        const containerTop = container?.getBoundingClientRect().top;
        const atTop = containerTop !== undefined ? firstTop - containerTop <= 16 : firstTop <= 40;
        console.info(`[dailog] cdp-driver stop count=${monitorNodes.length} scrollTop=${pos} firstTop=${firstTop} containerTop=${containerTop} atTop=${atTop}`);
        if (atTop) {
          void finishMonitorCollect();
        } else if (pointIndex < points.length - 1) {
          updateCollectHint("正在尝试调整滚动落点…");
          void startCdpDriver(container, pointIndex + 1); // 换备选落点重试
        } else {
          updateCollectHint("自动滚动失效，请手动滚动浏览完整对话；完成后点「完成」");
        }
      })();
    }, 300);
  }

  /** 停止 CDP 滚轮（background detach）+ 清理监测循环与保活（幂等） */
  function stopCdpDriver(): void {
    if (cdpWatchIv) {
      clearInterval(cdpWatchIv);
      cdpWatchIv = undefined;
    }
    cdpKeepalive?.disconnect();
    cdpKeepalive = undefined;
    void chrome.runtime.sendMessage({ type: MSG_CDP_SCROLL_STOP }).catch(() => {});
  }

  let scrollDebounce: ReturnType<typeof setTimeout> | undefined;
  let tickRunning = false;

  /** 滚动触发：即时读一次 + 150ms 停止后补读（等骨架渲染完内容） */
  function onUserScroll(): void {
    void tickMonitor();
    if (scrollDebounce) clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => void tickMonitor(), 150);
  }

  /** 单轮读取：读当前渲染出的消息 → 暂存合并 → 高亮 → 更新 FAB 计数 */
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
      const before = monitorNodes.length;
      mergeMessageNodes(monitorNodes, nodes);
      highlightNodes(nodes); // 当前渲染消息高亮（幂等）
      if (monitorNodes.length !== before) fab.updateCollectCount(monitorNodes.length);
    } catch {
      // 单轮读取失败忽略，下一轮重试
    } finally {
      tickRunning = false;
    }
  }

  /** 放弃采集（放弃按钮 / SPA 跳走）：清理状态与 UI */
  function cancelMonitorCollect(): void {
    stopMonitorLoop();
    stopCdpDriver();
    monitoring = false;
    hideCollectHint();
    clearHighlight();
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

  /** 完成采集：组装对话 → 进入确认态（FAB「确认导入 (N)」+ 放弃） */
  async function finishMonitorCollect(): Promise<void> {
    stopMonitorLoop();
    stopCdpDriver();
    monitoring = false;
    hideCollectHint();
    clearHighlight();
    const nodes = monitorNodes;
    try {
      const dialogue = await buildManualDialogue({ root: document, url: location.href, getRules }, nodes);
      if (!dialogue) {
        fab.showToast("未识别到对话内容，请确认已滚动浏览完整对话", "error");
        void updateCollectedState();
        return;
      }
      confirmMode = true;
      pendingDialogue = dialogue;
      fab.setConfirm(true, dialogue.messages.length, () => {
        confirmMode = false;
        pendingDialogue = null;
        fab.showToast("已取消采集", "success");
        void updateCollectedState();
      });
      fab.showToast(`已采集 ${dialogue.messages.length} 条，点击「确认导入」入库`, "success");
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
