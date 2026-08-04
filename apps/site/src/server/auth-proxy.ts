// site server 代理：统一登录会话端点——透传 better-auth 原生 cookie（会话由 api 管理）。
// 登录成功：api 响应 Set-Cookie: better-auth.session_token（生产 Domain=.dailog.fm，
// 本地 host-only localhost 跨端口共享）→ 两站（site/studio）自动带 cookie → SSO。
import { env } from "../lib/env";

/** 转发 api 认证端点：透传 body + 响应（含 Set-Cookie）与 cookie 头 */
export async function proxyAuth(path: string, request: Request): Promise<Response> {
  const headers: Record<string, string> = {};
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  const cookie = request.headers.get("cookie");
  if (cookie) headers["Cookie"] = cookie;

  // 显式声明来源站点（better-auth CSRF：无 Origin 请求被拒）
  headers["Origin"] = env.siteBaseUrl;
  const res = await fetch(`${env.apiBaseUrl}/api/auth/${path}`, {
    method: request.method,
    headers,
    body: await request.text().catch(() => ""),
  });

  const outHeaders: Record<string, string> = {
    "Content-Type": res.headers.get("content-type") ?? "application/json",
  };
  // 透传 api 的 Set-Cookie（better-auth.session_token 登录落地 / 登出清除）——SSO 关键
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) outHeaders["Set-Cookie"] = setCookie;

  return new Response(await res.text(), { status: res.status, headers: outHeaders });
}

/** 登出：透传 cookie（api 按 cookie 识别会话并清除） */
export async function proxySignOut(request: Request): Promise<Response> {
  const cookie = request.headers.get("cookie");
  const res = await fetch(`${env.apiBaseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      "Content-Type": "application/json",
      // 与 proxyAuth 一致：显式声明来源站点（better-auth CSRF：无 Origin 请求被拒）
      Origin: env.siteBaseUrl,
    },
    body: "{}",
  });
  const outHeaders: Record<string, string> = { "Content-Type": "application/json" };
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) outHeaders["Set-Cookie"] = setCookie;
  return new Response(await res.text(), { status: res.status, headers: outHeaders });
}
