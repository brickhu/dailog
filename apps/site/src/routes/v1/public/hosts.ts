import { proxyApi } from "../../../server/api-proxy";

// 主播列表（公开）：浏览器端同源代理 → API（避免跨域直连被 CORS 拦截）
export async function GET(event: { request: Request }) {
  return proxyApi("/v1/public/hosts", event.request, "GET");
}
