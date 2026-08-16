import { proxyApi } from "../../server/api-proxy";

// 当前登录用户概要（登录态检测：200 = 已登录，401 = 未登录）
export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me", event.request, "GET");
}
