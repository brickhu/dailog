import { env } from "../../../lib/env";

// 站内会话查询：透传 cookie 给 api（better-auth 原生 cookie 会话识别）
export async function GET(event: { request: Request }) {
  const cookie = event.request.headers.get("cookie");
  const res = await fetch(`${env.apiBaseUrl}/v1/auth/get-session`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
