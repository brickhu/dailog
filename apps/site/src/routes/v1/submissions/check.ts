import { proxyApi } from "../../../server/api-proxy";

// 投稿预检：同 URL 是否已投稿/已生成节目（输入地址即提示，登录态）
export async function POST(event: { request: Request }) {
  return proxyApi(`/v1/submissions/check`, event.request, "POST");
}
