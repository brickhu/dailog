import { proxyApi } from "../../server/api-proxy";

export async function POST(event: { request: Request }) {
  return proxyApi("/v1/import", event.request);
}
