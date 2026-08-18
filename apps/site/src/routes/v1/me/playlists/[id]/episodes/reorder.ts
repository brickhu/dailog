import { proxyApi } from "../../../../../../server/api-proxy";

export async function PUT(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/me/playlists/${event.params.id}/episodes/reorder`, event.request, "PUT");
}
