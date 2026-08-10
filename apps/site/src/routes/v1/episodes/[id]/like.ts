import { proxyApi } from "../../../../server/api-proxy";

export async function POST(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/v1/episodes/${event.params.id}/like`, event.request, "POST");
}

export async function DELETE(event: { params: { id: string }; request: Request }) {
  return proxyApi(`/v1/episodes/${event.params.id}/like`, event.request, "DELETE");
}
