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
