import { proxyApi } from "../../../../server/api-proxy";

export async function POST(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/api/episodes/${event.params.id}/favorite`, event.request, "POST");
}

export async function DELETE(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/api/episodes/${event.params.id}/favorite`, event.request, "DELETE");
}
