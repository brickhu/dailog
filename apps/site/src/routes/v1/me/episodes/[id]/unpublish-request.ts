import { proxyApi } from "../../../../../server/api-proxy";

export async function POST(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/me/episodes/${event.params.id}/unpublish-request`, event.request, "POST");
}
