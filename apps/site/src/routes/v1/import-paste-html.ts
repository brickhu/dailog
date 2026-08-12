import { proxyApi } from "../../server/api-proxy";

// 源码粘贴导入（分享页被 CF 拦截时，用户复制分享页源码粘贴）——站内代理
export async function POST(event: { request: Request }) {
  return proxyApi("/v1/import-paste/html", event.request);
}
