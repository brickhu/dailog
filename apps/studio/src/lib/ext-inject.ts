// 扩展 token 自动注入：cookie 会话 → GET /api/auth/token → sendMessage（页面加载/登录成功后调用）
import { env } from "./env";

declare const chrome: {
  runtime?: { sendMessage?: (id: string, msg: unknown) => Promise<unknown> };
};

/** 自动注入（静默失败：未装扩展/未登录/非浏览器环境均跳过） */
export async function injectExtensionToken(): Promise<void> {
  if (!env.extensionId || typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  try {
    const res = await fetch(`${env.apiBaseUrl}/api/auth/token`, { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { token?: string };
    if (data.token) {
      await chrome.runtime.sendMessage(env.extensionId, { type: "dailogues:set-token", token: data.token });
    }
  } catch {
    // 注入失败静默：采集时扩展会提示登录
  }
}
