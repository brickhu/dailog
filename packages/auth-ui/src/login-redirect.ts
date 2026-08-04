export interface LoginRedirectOptions {
  /** 允许回跳的源（白名单，防开放重定向）；默认仅同源 */
  allowedOrigins?: string[];
  /** 无 redirect 参数时的默认回跳 */
  fallback?: string;
}

/** 共享跳转逻辑："从哪里来就返回哪里去"——解析 redirect 参数 + 白名单校验 + 回跳目标。
 *  SSR 阶段（window 不存在）返回 fallback；两站共用同一实现。 */
export function getLoginRedirect(opts: LoginRedirectOptions = {}): string {
  const fallback = opts.fallback ?? "/";
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get("redirect");
  if (!raw) return fallback;
  try {
    const u = new URL(raw, window.location.origin);
    const allowed = opts.allowedOrigins ?? [window.location.origin];
    if (allowed.some((base) => u.origin === new URL(base).origin)) return u.pathname + u.search;
  } catch {
    /* 非法 URL 回默认 */
  }
  return fallback;
}
