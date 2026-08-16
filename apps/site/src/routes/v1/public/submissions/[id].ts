import { proxyApi } from "../../../../server/api-proxy";

// 投稿公开详情（公开页 /submission/<id>）
export async function GET(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/v1/public/submissions/${event.params.id}`, event.request, "GET");
}
