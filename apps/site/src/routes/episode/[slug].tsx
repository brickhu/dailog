import { Show, onMount } from "solid-js";
import { createAsync, useParams } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { CoverPlayer } from "../../components/cover-player";
import { EpisodeDetail } from "../../components/episode-detail";
import { usePlayback, type QueueEpisode } from "../../lib/playback";
import { getEpisode, getSlugById, type EpisodeSummary } from "../../lib/db";
import { env } from "../../lib/env";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 详情页（传统博客式）：dailog.fm/<episode_id> —— SSR 渲染（可索引/分享）。
// 布局：封面（左/上，内嵌播放控件）+ 详情（右/下）；播放由全局播放条贯通，
// 进入时节目进队列首位 + 推荐填充（播完自动连播下一期）。
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
    paddingBottom: "72px", // 播放条高度预留
  },
  body: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing8}`,
    display: "flex",
    gap: dimensions.spacing8,
    alignItems: "flex-start",
    "@media (max-width: 640px)": {
      flexDirection: "column",
      gap: dimensions.spacing5,
      padding: dimensions.spacing4,
    },
  },
  coverCol: {
    flexShrink: 0,
    width: "min(380px, 40vw)",
    "@media (max-width: 640px)": {
      width: "100%",
      maxWidth: "280px",
      margin: "0 auto",
    },
  },
  detailCol: {
    flex: 1,
    minWidth: 0,
    maxWidth: "640px",
  },
  notFound: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing12,
    color: colors.neutral,
    textAlign: "center",
  },
});

export default function EpisodeDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ slug: string }>();
  const playback = usePlayback();
  const data = createAsync(async () => {
    const bySlug = await getEpisode(params.slug);
    if (bySlug) return bySlug;
    // 兼容旧 /episode/<uuid>：按 id 查 slug，命中则跳转到新路径（客户端）
    if (typeof window !== "undefined") {
      const slug = await getSlugById(params.slug);
      if (slug) {
        window.location.replace(`/episode/${slug}`);
        return null;
      }
    }
    return null;
  });
  const ep = () => data();

  // EpisodeSummary（lib/db）→ QueueEpisode（播放器）
  const asQueue = (e: EpisodeSummary): QueueEpisode => ({
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: e.description,
    coverUrl: e.coverUrl,
    language: e.language ?? "zh",
    durationSeconds: e.durationSeconds,
    publishedAt: e.publishedAt,
    username: e.username ?? "",
    displayName: e.displayName ?? "",
    callName: e.callName,
    transcript: e.transcript,
    sourceUrl: e.sourceUrl,
  });

  // 客户端：播放器未激活（用户没选过节目）→ 初始化队列到本页节目（播完自动连播下一期）；
  // 已激活（正在播放中）→ 不重置队列，不打断播放（边听边逛）
  onMount(() => {
    const current = ep();
    if (!current || playback.activated()) return;
    const first = asQueue(current);
    const lang = locale() === "en" ? "en" : "zh";
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/episodes/recommended?lang=${lang}&limit=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((eps: unknown) => {
        const rest = Array.isArray(eps)
          ? (eps as QueueEpisode[]).filter((e) => e.id !== first.id).slice(0, 19)
          : [];
        playback.setQueue([first, ...rest]);
      })
      .catch(() => playback.setQueue([first]));
  });

  // 本页节目的播放状态与操作：本页节目是当前 → 暂停/继续；否则 → 播放本页（切歌）
  const thisEpisode = () => (ep() ? asQueue(ep()!) : null);
  const isThisPlaying = () => {
    const t = thisEpisode();
    return !!t && playback.current()?.id === t.id;
  };
  const handleToggle = () => {
    const t = thisEpisode();
    if (!t) return;
    if (isThisPlaying()) playback.toggle();
    else playback.play(t);
  };

  return (
    <div {...stylex.props(styles.page)}>
      <Title>{ep()?.title || "dailog"}</Title>
      <Show
        when={ep()}
        fallback={<div {...stylex.props(styles.notFound)}>{t("episode.notFound")}</div>}
      >
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.coverCol)}>
            <CoverPlayer
              episode={asQueue(ep()!)}
              playing={isThisPlaying() && playback.playing()}
              onToggle={handleToggle}
            />
          </div>
          <div {...stylex.props(styles.detailCol)}>
            <EpisodeDetail episode={asQueue(ep()!)} />
          </div>
        </div>
      </Show>
    </div>
  );
}
