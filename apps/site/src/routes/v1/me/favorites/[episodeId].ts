import { proxyApi } from "../../../../server/api-proxy";

export async function POST(event: { params: { episodeId: string }; request: Request }) {
  return proxyApi(`/v1/me/favorites/${event.params.episodeId}`, event.request, "POST");
}

export async function DELETE(event: { params: { episodeId: string }; request: Request }) {
  return proxyApi(`/v1/me/favorites/${event.params.episodeId}`, event.request, "DELETE");
}
