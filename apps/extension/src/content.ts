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
  MSG_COLLECT, MSG_CACHE_COLLECT, MSG_LIST_COLLECTS, MSG_GET_RULES, conversationKey,
  type CollectedDialogue, type CacheCollectResult, type ListCollectsResult, type CollectSummary,
  type GetRulesResult, type CollectRules, type CollectRule, type Platform,
} from "./shared";
import { collectFromDocument, resolvePlatform } from "./content/collector";
import { parseDeepSeekPage } from "./content/deepseek";
import { parseClaudePage } from "./content/claude";
import { waitForMutation } from "./content/mutation";
import { createFab, type FabController } from "./content/ui";
import { isConversationPage } from "./content/conversation-page";
import { applyRuleFallback } from "./content/read-fallback";
import { createStudioBadge } from "./content/studio-badge";
import { runCollectFlow } from "./content/collect-flow";
import { applyPrintCss } from "./content/print-css";
import type { MessageNode } from "./content/core";

/** 平台消息读取：本地专有解析器优先（打印撑开/滚动下全量提取）；
 *  本地选择器失配（站点 DOM 改版）→ 远程规则选择器同一文档兜底提取，
 *  避免掉到整页文本兜底（含导航噪音） */
async function readPlatformMessages(
  platform: Platform,
  parseLocal: (root: ParentNode) => MessageNode[],
): Promise<MessageNode[]> {
  const local = parseLocal(document);
  if (local.length > 0) return local;
  const rules = await getRules();
  return applyRuleFallback(local, rules?.platforms[platform], document);
}

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
    restore: () => restoreContainer(container),
  };
}

/** 找消息区域向上第一个可滚动容器（claude 滚动加载历史用；无固定容器类名，泛化探测）。
 *  注意：虚拟列表容器 scrollHeight≈clientHeight（只渲染视口窗口），
 *  不能要求有滚动余量——只要 overflow 可滚就认 */
function findScrollContainer(): HTMLElement | null {
  const first = document.querySelector("[data-testid='user-message'], [data-testid='assistant-message']");
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
    restore: () => restoreContainer(container),
  };
}

/** 当前页的滚动采集配置：平台专有容器优先（deepseek），否则泛化探测（claude） */
function pageScroll() {
  return deepSeekScroll() ?? claudeScroll();
}

// ============ 页面分流：studio 待入库角标 / AI 对话页采集 FAB ============

/** studio 域（hostname 不带端口；与 manifest matches 的「域名级」注入保持一致） */
const STUDIO_HOSTS = new Set(["app.dailog.fm", "localhost"]);

function isStudioPage(): boolean {
  return STUDIO_HOSTS.has(location.hostname);
}

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

// ---- studio 页面：右下角「N 条对话待入库」角标 ----

function initStudioBadge(): void {
  const badge = createStudioBadge({
    // 同源跳转（studio SPA 路由；全量刷新无妨，路由由 app 处理）
    onOpenItem: (collectId) => { window.location.href = `/import?collectId=${collectId}`; },
  });

  async function refresh(): Promise<void> {
    // /import 页本身不显示角标（该页已展示条目，确认/取消后条目消失）
    if (location.pathname.startsWith("/import")) {
      badge.setItems([]);
      return;
    }
    // 按当前页面 origin 过滤：dev(5173)/主网(app.dailog.fm) 的待入库互不串用
    badge.setItems(await listPending(location.origin));
  }

  void refresh();
  // SPA pushState 不触发 popstate——靠轮询兜底（角标数量跨标签页变化也靠它感知）
  setInterval(() => void refresh(), 3000);
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

  // 规则驱动显隐：默认表先行（避免闪烁），远程规则到达后重评
  // （打开平台页面时 background 已静默预热规则缓存，这里拿到的是最新规则）
  let rule: CollectRule | undefined;
  const applyVisibility = (url: string) => fab.setVisible(isConversationPage(url, rule));
  applyVisibility(location.href);
  void getRules().then((rules) => {
    if (!rules) return;
    const platform = resolvePlatform(rules, location.href);
    rule = platform ? rules.platforms[platform] : undefined;
    applyVisibility(location.href);
  });

  // 非对话页（首页等）隐藏按钮；SPA 导航进入对话页后自动显示
  void updateCollectedState();
  watchUrl((url) => {
    applyVisibility(url);
    void updateCollectedState();
  });
  setInterval(() => void updateCollectedState(), 3000);
}

if (isStudioPage()) {
  initStudioBadge();
} else {
  initConversationFab();
}

// 保留消息监听：popup「采集当前对话」触发本页采集（返回 dialogue，由 popup 转 background 缓存）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
