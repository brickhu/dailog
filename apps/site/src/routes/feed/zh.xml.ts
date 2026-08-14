import { buildFeedXml, feedResponse } from "../../lib/feed";

// 中文 feed：/feed/zh.xml（language=zh 的节目；无内容时 fallback 全量）
export async function GET(event: { request: Request }) {
  const xml = await buildFeedXml(event.request, "zh");
  return feedResponse(xml);
}
