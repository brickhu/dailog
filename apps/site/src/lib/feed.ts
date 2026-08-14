// 单 feed RSS 2.0 生成（dailog 频道，zh/en 分语言共用）：
// 标准：RSS 2.0 + iTunes namespace + Podcasting 2.0（season/episode）+ RFC 2822 日期 + enclosure length
// 供 Apple Podcasts / Spotify / 小宇宙 等订阅
import { detectLocale } from "@dailogues/i18n";
import { listFeedEpisodes, type FeedEpisode } from "./db";
import { env } from "./env";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 生成 RSS XML。lang 可选：按语言过滤（空则 fallback 全量，见 listFeedEpisodes） */
export async function buildFeedXml(request: Request, lang?: "zh" | "en"): Promise<string> {
  const locale = detectLocale({ acceptLanguage: request.headers.get("accept-language") });
  const episodes = await listFeedEpisodes(200, lang);
  // feed 语言声明跟随内容语言（显式传入时用内容语言，否则按浏览器语言）
  const feedLang = lang ?? (locale === "zh" ? "zh" : "en");
  // 频道描述按语言（统一文案）
  const channelDesc = feedLang === "zh"
    ? "听见人类和 AI 的思想交锋——一档模拟真人采访 AI 的播客。"
    : "Hear the clash between humans and AI — a podcast that simulates real humans interviewing AI.";

  const items = episodes
    .map((ep) => {
      const audio = `${env.apiBaseUrl}/v1/public/episodes/${ep.id}/audio`;
      const cover = `${env.apiBaseUrl}/v1/public/episodes/${ep.id}/cover`;
      const epUrl = `${env.siteBaseUrl}/episode/${ep.slug}`;
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
      <enclosure url="${audio}" type="${ep.audioUrl?.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg"}" length="${ep.audioSize ?? 0}"/>
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>dailog</title>
    <link>${env.siteBaseUrl}</link>
    <description>${xmlEscape(channelDesc)}</description>
    <language>${feedLang === "zh" ? "zh-cn" : "en"}</language>
    <itunes:author>dailog</itunes:author>
    <itunes:category text="Technology"/>
    <itunes:explicit>false</itunes:explicit>
    <podcast:season>1</podcast:season>
${items}
  </channel>
</rss>`;
}

/** RSS 响应（Content-Type + 缓存 10 分钟） */
export function feedResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=600" },
  });
}

export type { FeedEpisode };
