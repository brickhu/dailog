import { proxyApi } from "../../../server/api-proxy";

export async function GET(event: { request: Request }) {
  return proxyApi("/api/me/favorites", event.request, "GET");
}
