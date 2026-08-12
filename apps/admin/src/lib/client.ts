import { createApiClient } from "./api";
import { env } from "./env";

// 全局 api client：token 由 AuthProvider 挂载时注入（access_token 同步缓存）
let tokenGetter: () => string | null = () => null;
export function setTokenGetter(fn: () => string | null): void {
  tokenGetter = fn;
}

export const api = createApiClient({
  baseUrl: env.apiBaseUrl,
  getToken: () => tokenGetter(),
});

/** 后端资源 URL 拼接（音频流等非 JSON 资源；dev 走 vite 同源代理） */
export const apiUrl = (path: string): string => `${env.apiBaseUrl}${path}`;
