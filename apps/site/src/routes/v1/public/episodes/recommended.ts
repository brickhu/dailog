import { proxyApi } from "../../../../server/api-proxy";

// 推荐节目队列（公开）：浏览器端同源代理 → API
export async function GET(event: { request: Request }) {
  return proxyApi("/v1/public/episodes/recommended", event.request, "GET");
}
