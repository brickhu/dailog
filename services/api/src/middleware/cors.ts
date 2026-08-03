import type { MiddlewareHandler } from "hono";

// CORS：只允许配置的白名单 Origin（dev 本地 + 生产 app.dailogues.com）。
// 不匹配的 Origin 不加任何 CORS 头（api 仍可被 curl/服务端直调，浏览器跨域被浏览器自己拦截）。
export function createCorsMiddleware(origins: string[]): MiddlewareHandler {
  const allowed = new Set(origins);
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && allowed.has(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      c.header("Access-Control-Max-Age", "86400");
      // SSO：SPA 跨子域请求带会话 cookie（同站 SameSite=Lax）需要 credentials
      c.header("Access-Control-Allow-Credentials", "true");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  };
}
