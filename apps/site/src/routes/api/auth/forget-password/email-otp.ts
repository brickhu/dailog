import { proxyAuth } from "../../../../server/auth-proxy";

export async function POST(event: { request: Request }) {
  return proxyAuth("forget-password/email-otp", event.request);
}
