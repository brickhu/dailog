// 最小 chrome.runtime/storage 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  storage: {
    local: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
  };
  runtime: {
    onMessage: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
    onMessageExternal: {
      addListener: (listener: (message: any, sender: any, sendResponse: (response: unknown) => void) => boolean | void) => void;
    };
  };
};

import { MSG_COLLECT, type CollectResult, type CollectedDialogue } from "./shared";
import { API_BASE_KEY, DEFAULT_API_BASE } from "./env";

const TOKEN_KEY = "dailoguesToken";

/** 当前 API 基址：popup 覆盖值优先（chrome.storage），否则构建注入的默认值 */
export async function getApiBase(): Promise<string> {
  const { [API_BASE_KEY]: base } = await chrome.storage.local.get(API_BASE_KEY);
  return typeof base === "string" && base.length > 0 ? base : DEFAULT_API_BASE;
}

/** 设置 API 基址覆盖；传空串清除覆盖（恢复构建默认） */
export async function setApiBase(base: string): Promise<void> {
  const value = base.trim().replace(/\/+$/, "");
  if (!value) {
    await chrome.storage.local.remove(API_BASE_KEY);
    return;
  }
  await chrome.storage.local.set({ [API_BASE_KEY]: value });
}

export async function getToken(): Promise<string | null> {
  const { [TOKEN_KEY]: token } = await chrome.storage.local.get(TOKEN_KEY);
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** 采集结果回传：带 JWT POST {apiBase}/api/imports */
export async function handleCollect(dialogue: CollectedDialogue): Promise<CollectResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "no_token" };
  const apiBase = await getApiBase();
  try {
    const res = await fetch(`${apiBase}/api/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(dialogue),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, dialogue };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

// 测试环境（node）无 chrome.runtime —— 仅在浏览器运行时注册监听
if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  // app 页面（externally_connectable 白名单）经 sendMessage 注入 token
  chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "dailogues:set-token" && typeof msg.token === "string") {
      void chrome.storage.local.set({ [TOKEN_KEY]: msg.token }).then(() => sendResponse({ ok: true }));
      return true;
    }
  });
}
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // content script 采集结果 → 回传
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== MSG_COLLECT) return;
    void handleCollect(msg.dialogue as CollectedDialogue).then(sendResponse);
    return true;
  });
}
