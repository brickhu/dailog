import { Show, Suspense, createEffect, createSignal, onMount } from "solid-js";
import { createAsync, useParams } from "@solidjs/router";
import { Meta, Title } from "@solidjs/meta";
import { Cover } from "../../components/cover";
import { PlayControls } from "../../components/episode-card";
import { DetailSkeleton } from "../../components/route-skeletons";
import { EpisodeDetail } from "../../components/episode-detail";
import { usePlayback, type QueueEpisode } from "../../lib/playback";
import { getEpisodeCached } from "../../lib/episode-cache";
import type { EpisodeSummary } from "../../lib/db";
import { env, episodeCoverUrl } from "../../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
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
    position: "relative", // 三态播放按钮（PlayControls）覆盖右下角
    "@media (max-width: 640px)": {
      width: "100%",
      maxWidth: "280px",
      margin: "0 auto",
    },
  },
  // 播放按钮槽：封面右下角（固定尺寸 + flex——与 episode-card 的 btnSlot 同构：
  // 槽高不随内容类型变化，三态按钮位置恒定）
  coverBtnSlot: {
    position: "absolute",
    right: dimensions.spacing3,
    bottom: dimensions.spacing3,
    zIndex: 1,
    width: dimensions.sizeLg,
    height: dimensions.sizeLg,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
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

// cache() 在 lib/episode-cache.ts（列表页 hover 预取共用同一缓存）：
// route.preload 仅客户端 hover/导航预取（SSR 端 SolidStart 不调用）——SSR 数据
// 由 createAsync 的 fetch 在渲染期间真实执行，Suspense resolve 后 head OG 完整。
export const route = {
  preload: ({ params }: { params: { slug: string } }) => {
    void getEpisodeCached(params.slug);
  },
};

export default function EpisodeDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams<{ slug: string }>();
  const playback = usePlayback();
  const [coverHover, setCoverHover] = createSignal(false);
  const data = createAsync(() => getEpisodeCached(params.slug));
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

  // 旧 /episode/<uuid> 链接：API 按 id 兜底命中（ep.slug ≠ URL 参数）→ 客户端跳转新路径。
  // 放组件层而非 fetcher：SSR 返回的数据客户端 hydration 直接复用（fetcher 不再执行），
  // createEffect 在 hydration 后执行一次即触发跳转。
  createEffect(() => {
    const e = ep();
    if (typeof window !== "undefined" && e && e.slug !== params.slug) {
      window.location.replace(`/episode/${e.slug}`);
    }
  });

  // 本页节目的播放状态：本页节目是当前 → 暂停/继续；否则 → 播放本页（切歌）
  const thisEpisode = () => (ep() ? asQueue(ep()!) : null);
  const isThisPlaying = () => {
    const t = thisEpisode();
    return !!t && playback.current()?.id === t.id;
  };

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerMd)}>
      {/* 兜底标题：数据未就绪/404 时 head 也有 title（Suspense 内数据到达后 cascading 替换） */}
      <Title>dailog</Title>
      {/* OG 标签：社交分享卡片（og:image = 封面，各平台抓取展示）。
          ⚠️ 必须在 Suspense 内（数据就绪后）渲染——SSR 端 injectAssets 在渲染完成、shell
          输出前执行，挂起期间注册的 fallback 会被真实数据替换；放 Suspense 外则 head
          永远只有空值（社交爬虫读原始 HTML 拿不到标题/封面）。 */}
      <Suspense fallback={<DetailSkeleton />}>
      <Show
        when={ep()}
        fallback={<div {...stylex.props(styles.notFound)}>{t("episode.notFound")}</div>}
      >
        <Title>{ep()!.title || "dailog"}</Title>
        <Meta property="og:title" content={ep()!.title || "dailog"} />
        <Meta property="og:type" content="article" />
        <Meta property="og:url" content={`${env.siteBaseUrl}/episode/${ep()!.slug ?? ""}`} />
        <Meta property="og:description" content={ep()!.description?.slice(0, 200) || ""} />
        <Show when={ep()!.coverUrl && episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
          <Meta property="og:image" content={episodeCoverUrl(ep()!.id, ep()!.coverUrl)!} />
        </Show>
        <div {...stylex.props(layouts.fullRow, styles.body)}>
          <div
          {...stylex.props(styles.coverCol)}
          onPointerEnter={() => setCoverHover(true)}
          onPointerLeave={() => setCoverHover(false)}
        >
          <Cover episode={asQueue(ep()!)} />
          <div {...stylex.props(styles.coverBtnSlot)}>
            <PlayControls
              playing={isThisPlaying() && playback.playing()}
              onPlay={() => playback.play(asQueue(ep()!))}
              onPause={() => playback.toggle()}
              revealOnHover
              hovered={coverHover()}
            />
          </div>
        </div>
          <div {...stylex.props(styles.detailCol)}>
            <EpisodeDetail episode={asQueue(ep()!)} />
          </div>
        </div>
      </Show>
      </Suspense>
      </div>
    </div>
  );
}
