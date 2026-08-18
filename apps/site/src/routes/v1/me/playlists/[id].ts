import { proxyApi } from "../../../../server/api-proxy";

export async function GET(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/me/playlists/${event.params.id}`, event.request, "GET");
}

export async function PATCH(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/me/playlists/${event.params.id}`, event.request, "PATCH");
}

export async function DELETE(event: { request: Request; params: { id: string } }) {
  return proxyApi(`/v1/me/playlists/${event.params.id}`, event.request, "DELETE");
}
