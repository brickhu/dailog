import { Show, Suspense, createEffect, createSignal, onMount } from "solid-js";
import { createAsync, useParams } from "@solidjs/router";
import { Meta, Title } from "@solidjs/meta";
import { Cover } from "../../components/cover";
import { PlayControls } from "../../components/episode-card";
import { DetailSkeleton } from "../../components/page-skeletons";
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
// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (width >= 1024px)";

const styles = stylex.create({
  // page: {
  //   minHeight: "100vh",
  //   backgroundColor: colors.background,
  //   color: colors.foreground,
  //   fontFamily: "system-ui, -apple-system, sans-serif",
  //   paddingBottom: "72px", // 播放条高度预留
  // },
  // 背景装饰：封面图作为内容的一部分（absolute 随页面滚动自然滚走），
  // 高斯模糊 + 渐变遮罩 + 20% 透明度
  detail:{
    minHeight: "100vh",
    backgroundColor: colors.background,
    paddingBottom: "72px",
    position: "relative", // 背景层（absolute）的定位基准
  },
  bg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "50vh", // 只占首屏上半（跟随内容滚动，滚出视口自然消失）
    overflow: "hidden",
    pointerEvents: "none", // 纯装饰：不挡交互
    zIndex: 0,
  },
  bgImg: {
    width: "100%",
    height: "50vh",
    objectFit: "cover",
    filter: "blur(40px)",
    transform: "scale(1.15)", // 防模糊边缘露出底色
    opacity: 0.2, // 整体透明度 20%
  },
  bgGradient: {
    position: "absolute",
    inset: 0,
    // 顶部渐变遮罩：从顶到底——0% 处背景色 80% 显示（明显遮罩，图被盖住大半），
    // 50% 处 0%（全透明），下半程完全露出背景图。顶部融入页面背景、向下平滑过渡。
    // 20% 强度视觉几乎不可见（背景色只混入 1/5）；80% 让渐变清晰。
    // 不用 linear-gradient(背景色) 模板——stylex 编译期无法解析模板内引用的跨文件 var
    // backgroundColor: colors.background,
    maskImage: "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 10%)",
    WebkitMaskImage: "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 10%)",
  },
  // 内容层（containerLg 网格内）：盖在背景之上
  content: {
    position: "relative",
    zIndex: 1,
    paddingTop: dimensions.spacing8,
    paddingBottom: dimensions.spacing12,
  },
  // 封面列：span 4 通用（移动 4 列全宽 / 平板 8 列占 4 / 桌面 12 列占 4）
  coverCol: {
    gridColumn: "span 4",
    position: "relative", // 三态播放按钮（PlayControls）覆盖右下角
    minWidth: 0,
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
  // 内容列：移动 4 列全宽（自动折行）→ 平板 4 列（与封面并列）→ 桌面 8 列
  detailCol: {
    gridColumn: "span 4",
    minWidth: 0,
    [DESKTOP]: {
      gridColumn: "span 8",
    },
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
    audioUrl: e.audioUrl,
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

  return (
    <div {...stylex.props(layouts.page,styles.detail)}>
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
        {/* 背景装饰：小号封面图全屏铺底（fixed 视口固定）——模糊 + 上下渐变 + 20% 透明度 */}
        <div {...stylex.props(styles.bg)} aria-hidden="true">
          <Show when={ep()!.coverUrl && episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
            <img
              src={episodeCoverUrl(ep()!.id, ep()!.coverUrl, 320)!}
              alt=""
              {...stylex.props(styles.bgImg)}
            />
          </Show>
          <div {...stylex.props(styles.bgGradient)} />
        </div>
        {/* 内容：containerLg 网格（移动封面 4 列 + 内容 4 列折行；平板 4+4 并列；桌面 4+8 并列） */}
        <div {...stylex.props(layouts.containerLg, styles.content)}>
          <div
            {...stylex.props(styles.coverCol)}
            onPointerEnter={() => setCoverHover(true)}
            onPointerLeave={() => setCoverHover(false)}
          >
            <Cover episode={asQueue(ep()!)} />
            <div {...stylex.props(styles.coverBtnSlot)}>
              <PlayControls
                episode={asQueue(ep()!)}
                revealOnHover={!!ep()!.audioUrl} // audio 缺失：不启用 hover 划入，仅常显警告图标
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
  );
}
