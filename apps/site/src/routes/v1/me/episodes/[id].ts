import { proxyApi } from "../../../../server/api-proxy";

export async function PATCH(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/me/episodes/${event.params.id}`, event.request, "PATCH");
}
