import { proxyApi } from "../../../server/api-proxy";

// 手动粘贴兜底导入（分享页被 CF 拦截时）——同 /v1/import 走站内代理
export async function POST(event: { request: Request }) {
  return proxyApi("/v1/import-paste", event.request);
}
