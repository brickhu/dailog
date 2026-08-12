import { proxyApi } from "../../../server/api-proxy";

// 粘贴文本解析（不建库）——前端校对态数据源
export async function POST(event: { request: Request }) {
  return proxyApi("/v1/import-paste/parse", event.request);
}
