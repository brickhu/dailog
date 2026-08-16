import { proxyApi } from "../../../server/api-proxy";

// URL 可达性检测（导入弹框确认投稿前探活）：200 = 可达，422 = 不可达
export async function POST(event: { request: Request }) {
  return proxyApi(`/v1/submissions/reachable`, event.request, "POST");
}
