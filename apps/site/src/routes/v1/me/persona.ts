import { proxyApi } from "../../../server/api-proxy";

export async function PATCH(event: { request: Request }) {
  return proxyApi("/v1/me/persona", event.request, "PATCH");
}
