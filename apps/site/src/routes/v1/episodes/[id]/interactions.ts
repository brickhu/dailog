import { proxyApi } from "../../../../server/api-proxy";

// 当前用户对该节目的点赞/收藏状态（未登录 401 → 客户端仅展示公开计数）
export async function GET(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/v1/episodes/${event.params.id}/interactions`, event.request, "GET");
}
