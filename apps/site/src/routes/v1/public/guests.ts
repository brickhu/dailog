import { proxyApi } from "../../../server/api-proxy";

// 嘉宾列表（公开）：浏览器端同源代理 → API
export async function GET(event: { request: Request }) {
  return proxyApi("/v1/public/guests", event.request, "GET");
}
