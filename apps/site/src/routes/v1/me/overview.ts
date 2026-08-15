import { proxyApi } from "../../../server/api-proxy";

// 导航栏聚合：登录用户信息 + 未读数（替代 get-session/profile/unread 三连）
export async function GET(event: { request: Request }) {
  return proxyApi(`/v1/me/overview`, event.request, "GET");
}
