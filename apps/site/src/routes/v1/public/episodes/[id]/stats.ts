import { proxyApi } from "../../../../../server/api-proxy";

// 节目公开计数（播放/完播/点赞/收藏，不要求登录）：浏览器端同源代理 → API
export async function GET(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/v1/public/episodes/${event.params.id}/stats`, event.request, "GET");
}
