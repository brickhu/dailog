import { proxyApi } from "../../../../../server/api-proxy";

export async function GET(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/public/episodes/${event.params.id}/stats`, event.request, "GET");
}
