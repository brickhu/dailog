import { proxySignOut } from "../../../server/auth-proxy";

export async function POST(event: { request: Request }) {
  return proxySignOut(event.request);
}
