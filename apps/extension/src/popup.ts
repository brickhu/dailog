// popup：采集按钮（支持页面可点）+ 待入库列表（只读展示当前 Studio 地址）
// 无登录/频道状态机——鉴权是 app 的 auth provider 的事，扩展只做解析 + 缓存 + 跳转。
// 基址覆盖不在 popup 展示——本地联调在 dev 工具页（dev.html）里改
// 与 background 共享函数（esbuild 各自 bundle，逻辑操作同一 chrome.storage）

import { getAppBase, cacheCollect, isSupportedUrl, listCollects } from "./background";
import { MSG_COLLECT, type CollectedDialogue } from "./shared";
import { platformLabel, relativeTime } from "./format";

declare const chrome: {
  tabs: {
    query: (q: { active: boolean; currentWindow: boolean }) => Promise<{ id?: number; url?: string }[]>;
    sendMessage: (tabId: number, msg: unknown) => Promise<unknown>;
    create: (opts: { url: string }) => Promise<unknown>;
  };
};

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** 当前激活 tab（host_permissions 覆盖的域可读 url） */
async function activeTab(): Promise<{ id?: number; url?: string } | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

async function renderMain(): Promise<void> {
  const badge = $("state-badge");
  const btn = $("btn-primary") as HTMLButtonElement | null;
  const line = $("status-line");
  const studio = $("studio-url");
  const tab = await activeTab();
  if (studio) studio.textContent = await getAppBase();

  const supported = tab ? isSupportedUrl(tab.url) : false;
  if (badge) {
    badge.textContent = supported ? "可采集" : "当前页不支持";
    badge.className = `badge ${supported ? "ok" : ""}`;
  }
  if (!btn) return;

  btn.textContent = "采集当前对话";
  btn.disabled = !supported;
  if (line) {
    line.textContent = supported
      ? "将采集本页对话，并打开工作台确认入库。"
      : "当前页面不支持采集（需在支持的 AI 对话页）。";
  }
  btn.onclick = async () => {
    if (!tab?.id || !supported) return;
    btn.disabled = true;
    btn.textContent = "采集中…";
    try {
      // content script 采集 → 本地缓存（background 打开确认入库页）
      const res = (await chrome.tabs.sendMessage(tab.id, { type: MSG_COLLECT })) as
        | { ok: boolean; dialogue?: CollectedDialogue; error?: string }
        | undefined;
      if (!res?.ok) {
        if (line) line.textContent = `采集失败：${res?.error ?? "未知错误"}`;
        btn.disabled = false;
        btn.textContent = "采集当前对话";
        return;
      }
      const cached = await cacheCollect(res.dialogue!);
      if (!cached.ok) {
        if (line) line.textContent = `采集失败：${cached.error ?? "未知错误"}`;
        btn.disabled = false;
        btn.textContent = "采集当前对话";
        return;
      }
      window.close(); // 确认入库页已由 background 打开
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (line) line.textContent = msg.includes("Extension context invalidated") ? "页面已过期，请刷新后重试" : `采集失败：${msg}`;
      btn.disabled = false;
      btn.textContent = "采集当前对话";
    }
  };
}

/** 待入库列表：读扩展缓存，点条目新标签打开确认入库页（textContent 构建防页面内容注入） */
async function renderPending(): Promise<void> {
  const view = $("pending-view");
  const list = $("pending-list");
  if (!view || !list) return;
  const res = await listCollects();
  const items = res?.ok ? res.items : [];
  view.hidden = items.length === 0;
  if (items.length === 0) return;
  const count = $("pending-count");
  if (count) count.textContent = String(items.length);
  const appBase = await getAppBase();
  list.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.className = "pending-item";
    btn.type = "button";
    const title = document.createElement("div");
    title.className = "pending-item-title";
    title.textContent = item.title || "未命名对话";
    const meta = document.createElement("div");
    meta.className = "pending-item-meta";
    meta.textContent = `${platformLabel(item.platform)} · ${item.messageCount} 条消息 · ${relativeTime(item.createdAt)}`;
    btn.append(title, meta);
    btn.addEventListener("click", () => {
      void chrome.tabs.create({ url: `${appBase}/import?collectId=${item.collectId}` });
      window.close();
    });
    list.appendChild(btn);
  }
}

function init(): void {
  void renderMain();
  void renderPending();
}

init();
