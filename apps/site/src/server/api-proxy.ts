// site 通用 api 转发（收藏/点赞/收藏列表）：透传 cookie（better-auth 会话）+ 显式 Origin
import { env } from "../lib/env";

export async function proxyApi(path: string, request: Request, method?: string): Promise<Response> {
  const cookie = request.headers.get("cookie");
  const res = await fetch(`${env.apiBaseUrl}${path}`, {
    method: method ?? request.method,
    headers: cookie ? { Cookie: cookie, Origin: env.siteBaseUrl } : { Origin: env.siteBaseUrl },
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
  });
}
