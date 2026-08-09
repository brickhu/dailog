// site 通用 api 转发（收藏/点赞/账号档案等）：透传 cookie（better-auth 会话）+ 显式 Origin + body
import { env } from "../lib/env";

export async function proxyApi(path: string, request: Request, method?: string): Promise<Response> {
  const cookie = request.headers.get("cookie");
  const contentType = request.headers.get("content-type");
  const headers: Record<string, string> = { Origin: env.siteBaseUrl };
  if (cookie) headers["Cookie"] = cookie;
  if (contentType) headers["Content-Type"] = contentType;
  const finalMethod = method ?? request.method;
  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    method: finalMethod,
    headers,
    // 登录态业务请求（PATCH /api/me/profile 等）需要 body；GET 不带 body（undici 拒绝 GET 带 body）
    body: finalMethod === "GET" ? undefined : await request.text().catch(() => ""),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
