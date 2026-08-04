// 最小 chrome.runtime/storage 类型声明（扩展运行时有全局 chrome，tsconfig 仅含 node types）
declare const chrome: {
  tabs: {
    create: (opts: { url: string }) => Promise<unknown>;
  };
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
import { API_BASE_KEY, LOGIN_BASE_KEY, DEFAULT_API_BASE, DEFAULT_LOGIN_BASE } from "./env";

const TOKEN_KEY = "dailogToken";

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

/** 当前登录页基址：popup 覆盖值优先（chrome.storage），否则构建注入的默认值 */
export async function getLoginBase(): Promise<string> {
  const { [LOGIN_BASE_KEY]: base } = await chrome.storage.local.get(LOGIN_BASE_KEY);
  return typeof base === "string" && base.length > 0 ? base : DEFAULT_LOGIN_BASE;
}

export async function setLoginBase(base: string): Promise<void> {
  const value = base.trim().replace(/\/+$/, "");
  if (!value) {
    await chrome.storage.local.remove(LOGIN_BASE_KEY);
    return;
  }
  await chrome.storage.local.set({ [LOGIN_BASE_KEY]: value });
}

export async function getToken(): Promise<string | null> {
  const { [TOKEN_KEY]: token } = await chrome.storage.local.get(TOKEN_KEY);
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** 采集结果回传：带 session token POST {apiBase}/api/imports */
export async function handleCollect(
  dialogue: CollectedDialogue,
  senderUrl?: string,
): Promise<CollectResult> {
  const token = await getToken();
  if (!token) {
    // 未登录：带登录页地址（含 redirect 回当前对话页），由 content 展开登录引导
    const loginBase = await getLoginBase();
    const redirect = senderUrl ? encodeURIComponent(senderUrl) : "";
    return {
      ok: false,
      error: "no_token",
      loginUrl: `${loginBase}/login${redirect ? `?redirect=${redirect}` : ""}`,
    };
  }
  const apiBase = await getApiBase();
  try {
    const res = await fetch(`${apiBase}/api/imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(dialogue),
    });
    if (!res.ok) {
      // 错误码透传（body.error 优先）：channel_not_activated（未开通频道）/ 401（登录失效）等
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      const code = body?.error ?? `http_${res.status}`;
      // 401 登录失效：自动打开统一登录页，登录后 redirect 回对话页（token 由登录页自动注入）
      if (res.status === 401) {
        const loginBase = await getLoginBase();
        const redirect = senderUrl ? encodeURIComponent(senderUrl) : "";
        void chrome.tabs.create({
          url: `${loginBase}/login${redirect ? `?redirect=${redirect}` : ""}`,
        });
      }
      return { ok: false, error: code };
    }
    return { ok: true, dialogue };
  } catch (e) {
    return { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
}

// 测试环境（node）无 chrome.runtime —— 仅在浏览器运行时注册监听
if (typeof chrome !== "undefined" && chrome.runtime?.onMessageExternal) {
  // app 页面（externally_connectable 白名单）经 sendMessage 注入 token
  chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "dailog:set-token" && typeof msg.token === "string") {
      void chrome.storage.local.set({ [TOKEN_KEY]: msg.token }).then(() => sendResponse({ ok: true }));
      return true;
    }
  });
}
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // content script 采集结果 → 回传
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== MSG_COLLECT) return;
    void handleCollect(msg.dialogue as CollectedDialogue, sender?.tab?.url).then(sendResponse);
    return true;
  });
}
