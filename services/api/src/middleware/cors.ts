import type { MiddlewareHandler } from "hono";

// CORS：只允许配置的白名单 Origin（dev 本地 + 生产 app.dailogues.com）。
// 不匹配的 Origin 不加任何 CORS 头（api 仍可被 curl/服务端直调，浏览器跨域被浏览器自己拦截）。
function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    // SSO：SPA 跨子域请求带会话 cookie（同站 SameSite=Lax）需要 credentials
    "Access-Control-Allow-Credentials": "true",
  };
}

export function createCorsMiddleware(origins: string[]): MiddlewareHandler {
  const allowed = new Set(origins);
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (!origin || !allowed.has(origin)) {
      // 不匹配的 Origin 不加任何 CORS 头（api 仍可被 curl/服务端直调，浏览器跨域由浏览器拦截）
      if (c.req.method === "OPTIONS") return c.body(null, 204);
      return next();
    }
    if (c.req.method === "OPTIONS") {
      // 预检：走 Context 创建响应，c.header() 生效
      for (const [k, v] of Object.entries(corsHeaders(origin))) c.header(k, v);
      return c.body(null, 204);
    }
    await next();
    // 下游 handler 直接返回裸 Response 时（如 better-auth），c.header() 不会合并进响应，
    // 需在最终响应上显式补头（实测 GET/POST 丢失，OPTIONS 正常）
    const res = c.res;
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
    c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
