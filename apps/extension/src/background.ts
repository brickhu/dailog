// 最小 chrome.runtime/storage 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  storage: {
    local: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
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

const IMPORTS_URL = "https://api.dailogues.com/api/imports";
const TOKEN_KEY = "dailoguesToken";

export async function getToken(): Promise<string | null> {
  const { [TOKEN_KEY]: token } = await chrome.storage.local.get(TOKEN_KEY);
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** 采集结果回传：带 JWT POST /api/imports */
export async function handleCollect(dialogue: CollectedDialogue): Promise<CollectResult> {
  const token = await getToken();
  if (!token) return { ok: false, error: "no_token" };
  try {
    const res = await fetch(IMPORTS_URL, {
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
  // app.dailogues.com 页面经 externally_connectable 注入 token
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
