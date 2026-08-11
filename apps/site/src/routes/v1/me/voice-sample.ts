import { proxyApi } from "../../../server/api-proxy";

export async function POST(event: { request: Request }) {
  return proxyApi("/v1/me/voice-sample", event.request);
}

export async function GET(event: { request: Request }) {
  return proxyApi("/v1/me/voice-sample", event.request, "GET");
}
