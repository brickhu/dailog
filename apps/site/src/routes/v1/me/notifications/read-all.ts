import { proxyApi } from "../../../../server/api-proxy";

export async function POST(event: { request: Request }) {
  return proxyApi("/v1/me/notifications/read-all", event.request);
}
