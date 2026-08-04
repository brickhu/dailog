import { proxyAuth } from "../../../server/auth-proxy";

export async function POST(event: { request: Request }) {
  return proxyAuth("send-verification-email", event.request);
}
