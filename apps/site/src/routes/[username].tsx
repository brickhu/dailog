import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { siteDb, type EpisodeSummary } from "../lib/db";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

// 频道页：/@username（简介 + 节目列表 + RSS 订阅入口）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  header: {
    padding: `${tokens.space6} ${tokens.space4}`,
    borderBottom: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space5,
  },
  name: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  bio: {
    color: tokens.colorTextMuted,
    lineHeight: 1.7,
    marginBottom: tokens.space3,
  },
  meta: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  rss: {
    display: "inline-block",
    marginTop: tokens.space3,
    padding: `${tokens.space1} ${tokens.space3}`,
    borderRadius: tokens.radiusFull,
    border: `1px solid ${tokens.colorBorder}`,
    color: tokens.colorWarning,
    fontSize: tokens.fontSizeSm,
    textDecoration: "none",
  },
  card: {
    display: "block",
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space3,
    textDecoration: "none",
    color: "inherit",
  },
  epTitle: {
    fontWeight: tokens.fontWeightMedium,
    marginBottom: tokens.space1,
  },
  meta2: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  notFound: {
    color: tokens.colorTextMuted,
    textAlign: "center",
    padding: tokens.space7,
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ChannelPage() {
  const params = useParams<{ username: string }>();
  // URL /@username → 路由参数含 @ 前缀，查询前归一化
  const username = () => params.username.replace(/^@/, "");
  const data = createAsync(() => siteDb.getChannel(username()));

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <Show
          when={data()?.channel}
          fallback={<div {...stylex.props(styles.notFound)}>频道不存在</div>}
        >
          <div {...stylex.props(styles.header)}>
            <div {...stylex.props(styles.name)}>@{data()!.channel!.username}</div>
            <div {...stylex.props(styles.bio)}>{data()!.channel!.bio || "这个频道还没有简介"}</div>
            <div {...stylex.props(styles.meta)}>{data()!.channel!.episodeCount} 期节目</div>
            <a href={`/@${username()}/feed.xml`} {...stylex.props(styles.rss)}>
              RSS 订阅
            </a>
          </div>
          <For each={data()!.episodes as EpisodeSummary[]}>
            {(ep) => (
              <a href={`/episode/${ep.id}`} {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.epTitle)}>{ep.title || "未命名节目"}</div>
                <div {...stylex.props(styles.meta2)}>
                  {new Date(ep.publishedAt ?? 0).toLocaleDateString("zh-CN")} ·{" "}
                  {fmtDuration(ep.durationSeconds)}
                </div>
              </a>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
