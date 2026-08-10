import { proxyApi } from "../../../server/api-proxy";

export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me/profile", event.request, "GET");
}

export async function PATCH(event: { request: Request }) {
  return proxyApi("/v1/me/profile", event.request, "PATCH");
}
