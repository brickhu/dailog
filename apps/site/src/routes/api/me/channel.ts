import { proxyApi } from "../../../server/api-proxy";

export async function PATCH(event: { request: Request }) {
  return proxyApi("/api/me/channel", event.request, "PATCH");
}
