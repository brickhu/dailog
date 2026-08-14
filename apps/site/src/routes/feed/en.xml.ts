import { buildFeedXml, feedResponse } from "../../lib/feed";

// 英文 feed：/feed/en.xml（language=en 的节目；无内容时 fallback 全量）
export async function GET(event: { request: Request }) {
  const xml = await buildFeedXml(event.request, "en");
  return feedResponse(xml);
}
