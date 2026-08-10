import { proxyAuth } from "../../../../server/auth-proxy";

export async function POST(event: { request: Request }) {
  return proxyAuth("email-otp/reset-password", event.request);
}
