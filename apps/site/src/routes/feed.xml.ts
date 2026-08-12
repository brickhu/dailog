import { detectLocale } from "@dailogues/i18n";
import { listFeedEpisodes } from "../lib/db";
import { env } from "../lib/env";

// 单 feed RSS 2.0（dailog 频道）：/feed.xml
// 标准：RSS 2.0 + iTunes namespace + Podcasting 2.0（season/episode）+ RFC 2822 日期 + enclosure length
// 供 Apple Podcasts / Spotify / 小宇宙 等订阅

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(event: { request: Request }) {
  const locale = detectLocale({ acceptLanguage: event.request.headers.get("accept-language") });
  const episodes = await listFeedEpisodes();

  const items = episodes
    .map((ep) => {
      const audio = `${env.apiBaseUrl}/v1/public/episodes/${ep.id}/audio`;
      const cover = `${env.apiBaseUrl}/v1/public/episodes/${ep.id}/cover`;
      const epUrl = `${env.siteBaseUrl}/episode/${ep.id}`;
      const pubDate = ep.publishedAt ? new Date(ep.publishedAt).toUTCString() : new Date().toUTCString();
      const duration = ep.durationSeconds ? `\n      <itunes:duration>${ep.durationSeconds}</itunes:duration>` : "";
      // Podcasting 2.0：期号 + 季度（dailog 第 N 期）；enclosure length = 真实字节数
      const podcastEpisode = ep.episodeNumber ? `\n      <podcast:episode>${ep.episodeNumber}</podcast:episode>` : "";
      // 仅在有封面时输出 itunes:image（无封面节目避免死链）
      const itunesImage = ep.coverUrl ? `\n      <itunes:image href="${cover}"/>` : "";
      return `    <item>
      <title>${xmlEscape(ep.title || "未命名节目")}</title>
      <link>${epUrl}</link>
      <guid isPermaLink="false">${ep.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${xmlEscape(ep.description || "")}</description>${duration}${podcastEpisode}${itunesImage}
      <enclosure url="${audio}" type="audio/mpeg" length="${ep.audioSize ?? 0}"/>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>dailog</title>
    <link>${env.siteBaseUrl}</link>
    <description>${xmlEscape("让世界听到你和 AI 聊天的回响——真人采访 AI 的访谈式播客。")}</description>
    <language>${locale === "zh" ? "zh-cn" : "en"}</language>
    <itunes:author>dailog</itunes:author>
    <itunes:category text="Technology"/>
    <itunes:explicit>false</itunes:explicit>
    <podcast:season>1</podcast:season>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
}
