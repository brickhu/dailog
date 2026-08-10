import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { getChannel, type EpisodeSummary } from "../lib/db";
import { SiteNav } from "../components/site-nav";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 频道页：/@username（简介 + 节目列表 + RSS 订阅入口）
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  header: {
    padding: `${dimensions.spacing8} ${dimensions.spacing4}`,
    borderBottom: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing6,
  },
  name: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  bio: {
    color: colors.neutral,
    lineHeight: 1.7,
    marginBottom: dimensions.spacing3,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  rss: {
    display: "inline-block",
    marginTop: dimensions.spacing3,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    border: `1px solid ${colors.ink}`,
    color: colors.warning,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta2: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  notFound: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ChannelPage() {
  const { t } = useI18n();
  const params = useParams<{ username: string }>();
  // URL /@username → 路由参数含 @ 前缀，查询前归一化
  const username = () => params.username.replace(/^@/, "");
  const data = createAsync(() => getChannel(username()));

  return (
    <div {...stylex.props(styles.page)}>
      <SiteNav />
      <div {...stylex.props(styles.content)}>
        <Show
          when={data()?.channel}
          fallback={<div {...stylex.props(styles.notFound)}>{t("channel.notFound")}</div>}
        >
          <div {...stylex.props(styles.header)}>
            <div {...stylex.props(styles.name)}>@{data()!.channel!.username}</div>
            <div {...stylex.props(styles.bio)}>{data()!.channel!.bio || t("channel.noBio")}</div>
            <div {...stylex.props(styles.meta)}>{t("channel.episodeCount", { count: data()!.channel!.episodeCount })}</div>
            <a href={`/@${username()}/feed.xml`} {...stylex.props(styles.rss)}>
              RSS 订阅
            </a>
          </div>
          <For each={data()!.episodes as EpisodeSummary[]}>
            {(ep) => (
              <a href={`/episode/${ep.id}`} {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
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
