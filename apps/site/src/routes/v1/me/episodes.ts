import { proxyApi } from "../../../server/api-proxy";

export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me/episodes", event.request, "GET");
}
