import { proxyApi } from "../../../../server/api-proxy";

// 采样试听（同源代理）：<audio> 跨域请求不带 cookie，必须走同源代理透传会话
export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me/voice-sample/audio", event.request, "GET");
}
