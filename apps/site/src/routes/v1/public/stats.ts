import { proxyApi } from "../../../server/api-proxy";

// 站点统计（公开）：浏览器端同源代理 → API
export async function GET(event: { request: Request }) {
  return proxyApi("/v1/public/stats", event.request, "GET");
}
