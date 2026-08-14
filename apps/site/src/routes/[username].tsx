import { A, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { getRequestEvent, isServer } from "solid-js/web";
import { getChannel, type ChannelSummary, type EpisodeSummary } from "../lib/db";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 主持人主页：/@<username>（简介 + 节目列表 + RSS 订阅入口）
// 路由文件为 [username].tsx（/:username，radix3 限制无法用 @[username].tsx 生成 /@:username），
// 不带 @ 前缀的 /<username> 由组件内守卫拒绝（404）
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
    marginBottom: dimensions.spacing6,
  },
  avatar: {
    width: "72px",
    height: "72px",
    borderRadius: "50%",
    objectFit: "cover",
    marginBottom: dimensions.spacing3,
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
    color: colors.warning,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
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
  // 主持人主页统一 /@<username>（PRD）。radix3 不支持 /@:username 这种
  // 「字面 @ + 参数」混合段（segment 只能全字面或全参数），故路由只能是 /:username，
  // 在这里做 @ 前缀守卫：不带 @ 的 /<username> 视为无效路径 → 404（不查库）。
  const username = () => params.username.replace(/^@/, "");
  const isChannel = () => params.username.startsWith("@");
  if (isServer && !isChannel()) {
    getRequestEvent()!.response.status = 404;
  }
  const data = createAsync<{ channel: ChannelSummary | null; episodes: EpisodeSummary[] } | null>(() =>
    isChannel() ? getChannel(username()) : Promise.resolve(null)
  );

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <Show
          when={data()?.channel}
          fallback={<div {...stylex.props(styles.notFound)}>{t("channel.notFound")}</div>}
        >
          <div {...stylex.props(styles.header)}>
            <Show when={data()!.channel!.avatar}>
              <img src={data()!.channel!.avatar!} alt="" {...stylex.props(styles.avatar)} />
            </Show>
            <div {...stylex.props(styles.name)}>@{data()!.channel!.username}</div>
            <div {...stylex.props(styles.bio)}>{data()!.channel!.bio || t("channel.noBio")}</div>
            <div {...stylex.props(styles.meta)}>{t("channel.episodeCount", { count: data()!.channel!.episodeCount })}</div>
            <A  href="/feed.xml" {...stylex.props(styles.rss)}>
              RSS 订阅
            </A>
          </div>
          <For each={data()!.episodes as EpisodeSummary[]}>
            {(ep) => (
              <A  href={`/episode/${ep.slug}`} {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</div>
                <div {...stylex.props(styles.meta2)}>
                  {new Date(ep.publishedAt ?? 0).toLocaleDateString("zh-CN")} ·{" "}
                  {fmtDuration(ep.durationSeconds)}
                </div>
              </A>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
