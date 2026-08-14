import { buildFeedXml, feedResponse } from "../lib/feed";

// 主 feed /feed.xml：默认中文 feed（等价 /feed/zh.xml）。
// 保留原 URL 兼容现有订阅器（Apple/Spotify/小宇宙）；分语言 feed 见 /feed/[lang].xml
export async function GET(event: { request: Request }) {
  const xml = await buildFeedXml(event.request, "zh");
  return feedResponse(xml);
}
