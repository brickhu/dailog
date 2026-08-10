import { proxyApi } from "../../../../server/api-proxy";

export async function GET(event: { request: Request }) {
  // query（username 参数）透传：proxyApi 只转发 path，这里拼上原始 query
  const search = new URL(event.request.url).search;
  return proxyApi(`/v1/me/channel/check${search}`, event.request, "GET");
}
