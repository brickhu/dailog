import { proxyApi } from "../../../../server/api-proxy";

export async function GET(event: { request: Request; params: { slug: string } }) {
  return proxyApi(`/v1/public/playlists/${event.params.slug}`, event.request, "GET");
}
