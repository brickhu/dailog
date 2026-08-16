import { proxyApi } from "../../../../server/api-proxy";

// 单集公开详情（公开）：浏览器端同源代理 → API（SSR 直连 API，不走此代理）
export async function GET(event: { request: Request; params: { idOrSlug: string } }) {
  return proxyApi(`/v1/public/episodes/${event.params.idOrSlug}`, event.request, "GET");
}
