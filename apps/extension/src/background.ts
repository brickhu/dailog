// 最小 chrome.runtime/storage/tabs/action/debugger 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  debugger: {
    attach: (target: { tabId: number }, version: string) => Promise<void>;
    detach: (target: { tabId: number }) => Promise<void>;
    sendCommand: (target: { tabId: number }, method: string, params?: unknown) => Promise<unknown>;
    onDetach: { addListener: (cb: () => void) => void };
  };
  tabs: {
    create: (opts: { url: string }) => Promise<{ id?: number }>;
    remove: (tabId: number) => Promise<void>;
    get: (tabId: number) => Promise<{ url?: string }>;
    query: (opts: Record<string, unknown>) => Promise<Array<{ id?: number }>>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
    onActivated: { addListener: (cb: (info: { tabId: number }) => void) => void };
    onUpdated: { addListener: (cb: (tabId: number, info: { url?: string }) => void) => void };
    onRemoved: { addListener: (cb: (tabId: number) => void) => void };
  };
  action: {
    setIcon: (opts: { tabId: number; path: Record<string, string> }) => Promise<void>;
    setTitle: (opts: { tabId: number; title: string }) => Promise<void>;
  };
  storage: {
    local: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
  };
  runtime: {
    getURL: (path: string) => string;
    onMessage: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
    onMessageExternal: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
  };
};

import {
  MSG_CACHE_COLLECT, MSG_GET_COLLECT, MSG_DELETE_COLLECT, MSG_CLOSE_TAB, MSG_LIST_COLLECTS, MSG_GET_RULES, MSG_COLLECTS_CHANGED,
  MSG_CDP_SCROLL_START, MSG_CDP_SCROLL_STOP,
  isCollectedDialogue, conversationKey,
  type CollectedDialogue, type CacheCollectResult,
  type GetCollectResult, type DeleteCollectResult,
  type CollectSummary, type ListCollectsResult,
  type CollectRules, type GetRulesResult,
} from "./shared";
import { DEFAULT_APP_BASE, DEFAULT_RULES_URL } from "./env";

/** 本地采集缓存（确认入库页展示用；确认入库/取消后删除） */
const COLLECTS_KEY = "dailogCollects";
/** 本地缓存上限（条），超出按 createdAt 裁剪最旧 */
const MAX_COLLECTS = 20;

// ============ 运行时配置（options 配置页编辑，存 chrome.storage；保存即生效） ============

/** 运行时配置（options 页可编辑；结构可扩展） */
export interface RuntimeConfig {
  /** 工作台（studio）基址——采集确认入库页跳转目标 */
  appBase?: string;
}

const CONFIG_KEY = "dailogConfig";

/** 读运行时配置（直接读 storage：配置页保存后立即生效，无需重载扩展） */
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const { [CONFIG_KEY]: cfg } = await chrome.storage.local.get(CONFIG_KEY);
  return cfg && typeof cfg === "object" ? (cfg as RuntimeConfig) : {};
}

/** 写运行时配置（options 配置页使用；空对象 = 清除全部覆盖，回退构建默认） */
export async function setRuntimeConfig(cfg: RuntimeConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: cfg });
}

/** 当前工作台（studio）基址——确认入库页跳转目标（运行时配置优先，构建默认兜底） */
export async function getAppBase(): Promise<string> {
  const cfg = await getRuntimeConfig();
  return cfg.appBase?.trim() || DEFAULT_APP_BASE;
}

// ============ 本地缓存（采集后暂存，确认入库页读取；确认入库/取消后删除） ============

interface CollectEntry {
  dialogue: CollectedDialogue;
  createdAt: number;
  /** 条目所属 app 基址（采集时的生效基址）——按域隔离：dev(5173)/主网(app.dailog.fm) 的待入库互不串用 */
  appBase: string;
}

/** 打开中的导入确认页（tabId → collectId）：tab 被直接关闭（X/⌘W/崩溃）时兜底删除缓存副本，
 *  不依赖页面 JS（pagehide 里发扩展消息不可靠）。提交成功/取消删缓存时同步清记录——幂等 */
const pendingTabs = new Map<number, string>();

function readCollects(map: unknown): Record<string, CollectEntry> {
  return map && typeof map === "object" ? (map as Record<string, CollectEntry>) : {};
}

/** 缓存采集结果：写入 chrome.storage（限 MAX_COLLECTS 条）。
 *  同会话（conversationKey 归一）重采：复用原 collectId 原地更新——身份稳定，
 *  已打开的 /import?<id> 确认页不会因重采而失效。
 *  自动打开 app 确认入库页（background 的 chrome.tabs.create 不受弹窗拦截限制——
 *  异步采集流程结束后 content 侧 window.open 已不在用户手势上下文）。
 *  是否登录/开通频道不在此校验——那是 app 的 auth provider 在入库时的事。 */
export async function cacheCollect(dialogue: CollectedDialogue): Promise<CacheCollectResult> {
  if (!isCollectedDialogue(dialogue)) return { ok: false, error: "invalid_dialogue" };
  const appBase = await getAppBase();
  const { [COLLECTS_KEY]: map } = await chrome.storage.local.get(COLLECTS_KEY);
  const collects = readCollects(map);
  // 重采集：复用同会话旧条目的 collectId（无则新建）
  const key = conversationKey(dialogue.url);
  let collectId: string = crypto.randomUUID();
  for (const id of Object.keys(collects)) {
    if (conversationKey(collects[id].dialogue.url) === key) {
      collectId = id;
      break;
    }
  }
  collects[collectId] = { dialogue, createdAt: Date.now(), appBase };
  const sorted = Object.entries(collects).sort((a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0));
  const pruned = Object.fromEntries(sorted.slice(0, MAX_COLLECTS));
  await chrome.storage.local.set({ [COLLECTS_KEY]: pruned });
  const appUrl = `${appBase}/import?collectId=${collectId}`;
  const tab = await chrome.tabs.create({ url: appUrl });
  if (tab.id) pendingTabs.set(tab.id, collectId);
  return { ok: true, collectId, appUrl };
}

/** 读取缓存条目摘要（按 createdAt 倒序；appBase 过滤——不传按当前生效基址。
 *  旧条目（无 appBase 字段，本次改动前采集）视为全域可见，入库/取消后自然消失） */
export async function listCollects(appBase?: string): Promise<ListCollectsResult> {
  const base = appBase ?? (await getAppBase());
  const { [COLLECTS_KEY]: map } = await chrome.storage.local.get(COLLECTS_KEY);
  const items: CollectSummary[] = Object.entries(readCollects(map))
    .filter(([, entry]) => !entry.appBase || entry.appBase === base)
    .map(([collectId, entry]) => ({
      collectId,
      title: entry.dialogue.title,
      platform: entry.dialogue.platform,
      url: entry.dialogue.url,
      createdAt: entry.createdAt,
      messageCount: entry.dialogue.messages.length,
      appBase: entry.appBase,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { ok: true, items };
}

/** 读取本地缓存（确认入库页展示） */
export async function getCollect(collectId: string): Promise<GetCollectResult> {
  const { [COLLECTS_KEY]: map } = await chrome.storage.local.get(COLLECTS_KEY);
  const entry = readCollects(map)[collectId];
  if (!entry) return { ok: false, error: "collect_not_found" };
  return { ok: true, dialogue: entry.dialogue };
}

/** 缓存条目变化广播：通知所有 content script 立即刷新 FAB「已采集」状态
 *  （删除/新增后无需等 3 秒轮询；sendMessage 失败静默——轮询仍是兜底） */
async function notifyCollectsChanged(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id) continue;
      try {
        await chrome.tabs.sendMessage(t.id, { type: MSG_COLLECTS_CHANGED });
      } catch {
        // 无 content script 的 tab（chrome://、未注入页面等）静默
      }
    }
  } catch {
    // tabs.query 失败（权限等）静默——轮询兜底
  }
}

/** 删除本地缓存（取消采集 / 已入库清理 / 导入窗关闭兜底）；
 *  成功后广播缓存变化（FAB 立即恢复「采集对话」） */
export async function deleteCollect(collectId: string): Promise<DeleteCollectResult> {
  const { [COLLECTS_KEY]: map } = await chrome.storage.local.get(COLLECTS_KEY);
  const collects = readCollects(map);
  if (collectId in collects) {
    delete collects[collectId];
    await chrome.storage.local.set({ [COLLECTS_KEY]: collects });
  }
  // 同步清理打开的导入窗记录（幂等：取消/提交先删则 onRemoved 不再重复删）
  for (const [tabId, id] of pendingTabs) {
    if (id === collectId) pendingTabs.delete(tabId);
  }
  void notifyCollectsChanged();
  return { ok: true };
}

// ============ 图标状态（支持采集的 URL 彩色，其余灰色） ============

/** content_scripts 覆盖的采集平台域名（域名级判定；与 manifest matches 保持一致） */
const SUPPORTED_HOSTS = new Set([
  "claude.ai",
  "chat.deepseek.com",
  "chatgpt.com",
  "gemini.google.com",
  "kimi.moonshot.cn",
  "www.doubao.com",
  "www.tongyi.com",
]);

const COLOR_ICONS: Record<string, string> = {
  "16": "icons/color/icon16.png",
  "32": "icons/color/icon32.png",
  "48": "icons/color/icon48.png",
  "128": "icons/color/icon128.png",
};
const GRAY_ICONS: Record<string, string> = {
  "16": "icons/gray/icon16.png",
  "32": "icons/gray/icon32.png",
  "48": "icons/gray/icon48.png",
  "128": "icons/gray/icon128.png",
};

export function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return SUPPORTED_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function updateIconForTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const supported = isSupportedUrl(tab.url);
    await chrome.action.setIcon({ tabId, path: supported ? COLOR_ICONS : GRAY_ICONS });
    await chrome.action.setTitle({
      tabId,
      title: supported ? "dailog 采集器" : "当前页面不支持采集",
    });
  } catch {
    // 无权限读取的 tab（chrome:// 等）静默：保持默认图标
  }
}

// ============ 远程抓取规则（采集失败 fallback；TTL 缓存） ============

const RULES_TTL_MS = 10 * 60_000;
let rulesCache: { rules: CollectRules; at: number } | null = null;
/** 测试辅助：清规则缓存 */
export function resetRulesCache(): void {
  rulesCache = null;
}

/** 拉取远程抓取规则（jsDelivr 固定 URL；失败返回 ok:false，content 侧静默跳过） */
export async function getRemoteRules(): Promise<GetRulesResult> {
  if (rulesCache && Date.now() - rulesCache.at < RULES_TTL_MS) {
    return { ok: true, rules: rulesCache.rules };
  }
  try {
    const res = await fetch(DEFAULT_RULES_URL);
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const rules = (await res.json()) as CollectRules;
    if (!rules?.platforms || typeof rules.platforms !== "object") {
      return { ok: false, error: "invalid_rules" };
    }
    rulesCache = { rules, at: Date.now() };
    return { ok: true, rules };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

// ============ CDP 自动滚动（真实鼠标滚轮事件——虚拟列表必须响应） ============

let cdpScrollTimer: ReturnType<typeof setInterval> | undefined;
let cdpScrollTab: number | undefined;

export interface CdpScrollOptions {
  /** 滚轮事件落点（视口坐标，须落在消息区上） */
  x: number;
  y: number;
  /** 滚动量（负 = 向上） */
  deltaY: number;
  /** 事件间隔 ms（连续派发 = 模拟按住滚轮匀速滚动） */
  intervalMs: number;
}

export type CdpScrollResult = { ok: true } | { ok: false; error: string };

/** 挂载 debugger 并按固定节奏向页面派发真实滚轮事件（isTrusted=true，
 *  浏览器层面即用户输入——虚拟列表必须响应）。
 *  失败（DevTools 已开/已被占用/已运行）返回错误，采集侧降级手动 */
export async function startCdpScroll(tabId: number, opts: CdpScrollOptions): Promise<CdpScrollResult> {
  if (cdpScrollTimer) return { ok: false, error: "already_running" };
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  cdpScrollTab = tabId;
  cdpScrollTimer = setInterval(() => {
    void chrome.debugger
      .sendCommand({ tabId }, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: opts.x,
        y: opts.y,
        deltaX: 0,
        deltaY: opts.deltaY,
      })
      .catch(() => stopCdpScroll()); // attach 失效（页面刷新/DevTools 打开）→ 停止
  }, opts.intervalMs);
  return { ok: true };
}

/** 停止滚轮并 detach（幂等） */
export function stopCdpScroll(): void {
  if (cdpScrollTimer) {
    clearInterval(cdpScrollTimer);
    cdpScrollTimer = undefined;
  }
  if (cdpScrollTab !== undefined) {
    const tabId = cdpScrollTab;
    cdpScrollTab = undefined;
    void chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// 会话丢失（页面刷新/DevTools 打开/扩展重载）→ 清理孤儿定时器
if (typeof chrome !== "undefined" && chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener(() => {
    if (cdpScrollTimer) {
      clearInterval(cdpScrollTimer);
      cdpScrollTimer = undefined;
    }
    cdpScrollTab = undefined;
  });
}

// ============ 消息监听（仅在浏览器运行时注册；node 测试环境跳过） ============

// 平台域名 tab 访问时预热规则缓存：用户打开/刷新目标平台页面即静默拉取
// （getRemoteRules 内部 TTL 判定——首次访问/缓存过期才请求 CDN，session 内复用），
// content script 注入后经 MSG_GET_RULES 拿到的即最新规则，无需等采集才拉
export function warmRulesCache(url: string | undefined): void {
  if (!url || !isSupportedUrl(url)) return;
  void getRemoteRules();
}

if (typeof chrome !== "undefined" && chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(({ tabId }) => void updateIconForTab(tabId));
}
if (typeof chrome !== "undefined" && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.url) {
      void updateIconForTab(tabId);
      warmRulesCache(info.url);
    }
  });
}
// 导入确认页被直接关闭（X/⌘W/崩溃）→ 兜底删除缓存副本（不依赖页面 JS；
// 提交成功/取消已删则 pendingTabs 无记录，幂等）。导出便于测试（监听注册在浏览器运行时）
export function handleTabRemoved(tabId: number): void {
  const collectId = pendingTabs.get(tabId);
  if (!collectId) return;
  pendingTabs.delete(tabId);
  void deleteCollect(collectId);
}

if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(handleTabRemoved);
}

/** app 页面（externally_connectable 白名单）消息处理：读取/删除本地采集缓存、关闭当前标签页。
 *  导出便于测试；不匹配返回 null */
export function handleExternalMessage(
  msg: any,
  sender: { tab?: { id?: number } },
): Promise<unknown> | null {
  if (msg?.type === MSG_GET_COLLECT && typeof msg.collectId === "string") {
    return getCollect(msg.collectId);
  }
  if (msg?.type === MSG_DELETE_COLLECT && typeof msg.collectId === "string") {
    return deleteCollect(msg.collectId);
  }
  // 取消导入：由扩展关闭标签页（网页 window.close 受「只能关脚本打开的窗口」限制）
  if (msg?.type === MSG_CLOSE_TAB && sender.tab?.id) {
    return chrome.tabs.remove(sender.tab.id).then(() => ({ ok: true }), () => ({ ok: false }));
  }
  return null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
    const p = handleExternalMessage(msg, sender);
    if (p) {
      void p.then(sendResponse);
      return true;
    }
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // content script 消息：缓存采集结果 / 读取全部缓存条目 / 拉取远程抓取规则
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === MSG_CACHE_COLLECT) {
      void cacheCollect(msg.dialogue as CollectedDialogue).then(sendResponse);
      return true;
    }
    if (msg?.type === MSG_LIST_COLLECTS) {
      void listCollects(typeof msg.appBase === "string" ? msg.appBase : undefined).then(sendResponse);
      return true;
    }
    if (msg?.type === MSG_GET_RULES) {
      void getRemoteRules().then(sendResponse);
      return true;
    }
    if (msg?.type === MSG_CDP_SCROLL_START && _sender.tab?.id) {
      const tabId = _sender.tab.id;
      void startCdpScroll(tabId, {
        x: Number(msg.x) || 0,
        y: Number(msg.y) || 0,
        deltaY: Number(msg.deltaY) || -36,
        intervalMs: Number(msg.intervalMs) || 24,
      }).then(sendResponse);
      return true;
    }
    if (msg?.type === MSG_CDP_SCROLL_STOP) {
      stopCdpScroll();
      sendResponse({ ok: true });
      return true;
    }
  });
}
