import { proxyApi } from "../../../server/api-proxy";

export async function POST(event: { request: Request }) {
  return proxyApi("/v1/me/voice-sample", event.request);
}

export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me/voice-sample", event.request, "GET");
}

// 只改该语种采样行上的「节目称呼」（callName）。**这个方法不能漏**：漏了请求会落到 SPA fallback，
// 拿到 200 + HTML —— 前端以为保存成功、重新拉取时又把旧值填回来（表现为"改了没用/被自动换回"）。
export async function PATCH(event: { request: Request }) {
  return proxyApi("/v1/me/voice-sample", event.request, "PATCH");
}
