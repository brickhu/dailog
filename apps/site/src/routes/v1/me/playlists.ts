import { proxyApi } from "../../../server/api-proxy";

export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me/playlists", event.request, "GET");
}

export async function POST(event: { request: Request }) {
  return proxyApi("/v1/me/playlists", event.request, "POST");
}
