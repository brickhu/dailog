import { proxyApi } from "../../../../server/api-proxy";

// 当前用户单条投稿详情（含最新节目信息）
export async function GET(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/v1/me/submissions/${event.params.id}`, event.request, "GET");
}
