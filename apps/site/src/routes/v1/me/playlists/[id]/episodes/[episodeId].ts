import { proxyApi } from "../../../../../../server/api-proxy";

export async function DELETE(event: { request: Request; params: { id: string; episodeId: string } }) {
  return proxyApi(`/v1/me/playlists/${event.params.id}/episodes/${event.params.episodeId}`, event.request, "DELETE");
}
