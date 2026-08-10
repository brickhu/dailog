import { detectLocale } from "@dailogues/i18n";
import { getChannel } from "../../lib/db";
import { env } from "../../lib/env";

// RSS 2.0：/@username/feed.xml（播客订阅；enclosure = 音频 URL）
// SolidStart API route：导出 GET 处理器返回 Response（XML content-type）

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(event: { params: { username: string }; request: Request }) {
  const locale = detectLocale({ acceptLanguage: event.request.headers.get("accept-language") });
  const { channel, episodes } = await getChannel(event.params.username.replace(/^@/, ""));
  if (!channel) {
    return new Response("channel not found", { status: 404 });
  }

  const channelUrl = `${env.siteBaseUrl}/@${channel.username}`;
  const items = episodes
    .map((ep) => {
      const audio = `${env.apiBaseUrl}/v1/public/episodes/${ep.id}/audio`;
      const epUrl = `${env.siteBaseUrl}/episode/${ep.id}`;
      const pubDate = ep.publishedAt
        ? new Date(ep.publishedAt).toUTCString()
        : new Date().toUTCString();
      const duration = ep.durationSeconds ? `\n      <itunes:duration>${ep.durationSeconds}</itunes:duration>` : "";
      return `    <item>
      <title>${xmlEscape(ep.title || "未命名节目")}</title>
      <link>${epUrl}</link>
      <guid isPermaLink="false">${ep.id}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${xmlEscape(ep.description || "")}</description>${duration}
      <enclosure url="${audio}" type="audio/mpeg" length="0"/>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${xmlEscape(channel.displayName)}</title>
    <link>${channelUrl}</link>
    <description>${xmlEscape(channel.bio || "")}</description>
    <language>${locale === "zh" ? "zh-cn" : "en"}</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
