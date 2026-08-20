import { Show, Suspense, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { NoHydration } from "solid-js/web";
import { createAsync, useNavigate, useParams } from "@solidjs/router";
import { Meta, Title } from "@solidjs/meta";
import { Cover } from "../../components/cover";
import { PlayButton } from "../../components/play-button";
import { ShareDialog } from "../../components/share-buttons";
import { AddToPlaylistDialog } from "../../components/add-to-playlist";
import { DetailSkeleton } from "../../components/page-skeletons";
import { usePlayback, type QueueEpisode } from "../../lib/playback";
import { getEpisodeCached } from "../../lib/episode-cache";
import type { EpisodeSummary } from "../../lib/db";
import { apiBaseForFetch, env, episodeCoverUrl } from "../../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts, typography, shadows, dimensions, colors } from "@dailogues/ui/theme.stylex";
import { Button, Icon } from "@dailogues/ui";
// import { DESKTOP } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

// 详情页（传统博客式）：dailog.fm/<episode_id> —— SSR 渲染（可索引/分享）。
// 布局：封面（左/上，内嵌播放控件）+ 详情（右/下）；播放由全局播放条贯通，
// 进入时节目进队列首位 + 推荐填充（播完自动连播下一期）。
// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）

const TABLET = "@media (width>=640px)";

const styles = stylex.create({
  // 响应式列数（Grid 单值 columns={4}，断点覆盖走 xstyle + @media）
  page: {
    minHeight: "100vh",
    paddingBlock: dimensions.spacing4,
    gap: dimensions.spacing8,
    [TABLET]: {
      paddingBlock: dimensions.spacing12,
    }
  },
  grid: {
    display: "grid",
    gridTemplateColumns : "repeat(4, 1fr)",
    gap: dimensions.spacing4, 
    maxWidth: dimensions.tablet, 
    minWidth: dimensions.mobile,
    padding: dimensions.spacing4,
    width: "100%",
    [TABLET]: {
      gridTemplateColumns : "repeat(6, 1fr)",
    },
  },
  head: {
    // backgroundColor : "blue"
    // display: "grid",
    // gridTemplateColumns : "repeat(4, 1fr)",
    // gap: dimensions.spacing4, 
    // maxWidth: dimensions.tablet, 
    // minWidth: dimensions.mobile,
    // padding: dimensions.spacing4,
    // width: "100%",
    // [TABLET]: {
    //   gridTemplateColumns : "repeat(6, 1fr)",
    // },
  },
  main: {

  },
  foot : {},
  titleOutter : {
    gridColumn : "1 / -1",
    order: 2,
    [TABLET]: {
      gridColumn : "span 4",
      order: 1,
    },
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2
  },
  coverOutter : {
    gridColumn : "1 / -1",
    gridRow: "span 2",
    display : "flex",
    alignItems : "center",
    justifyContent : "center",
    order: 1,
    aspectRatio: 4/3,
    [TABLET]: {
      gridColumn : "span 2",
      justifyContent : "flex-end",
      order: 2,
    },
  },
  actionOutter : {
    gridColumn : "1 / -1",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: dimensions.spacing4,
     order: 3,
    [TABLET]: {
      gridColumn : "span 4",
    },
  },
  title : {
     
  },
  caption: {
    opacity : "50%"
  },
  desc: {
    gridColumn : "1 / -1",
  },
  // 点赞激活态（已赞：红粉心形点亮）
  likeActive: {
    color: colors.danger,
  },
  // titleWarp: {
  //   // textAlign: "center",
  //   // paddingInline: dimensions.spacing4
  //   display: "flex",
  //   flexDirection: "column",
  //   gap: dimensions.spacing4
  // },
  // titleMeta: {
  //   color: colors.neutral
  // },
  // titleName: {},

  // coverBlock: {
  //   aspectRatio: "1/1",
  //   order:1,
  //   [TABLET]: {
  //     order: 2
  //   },
  //   display : "flex",
  //   alignItems: "center",
  //   justifyContent: "center"
  // },
  cover:{
    maxWidth : `calc(${dimensions.size2xl} * 3)`,
    minWidth : dimensions.size2xl,
    width : "90%",
    boxShadow: shadows.shadowMed,
    borderRadius : dimensions.radiusMd
  },
  // detail:{
  //   order:3
  // }
  // 背景装饰：封面图作为内容的一部分（absolute 随页面滚动自然滚走），
  // 高斯模糊 + 渐变遮罩 + 20% 透明度
  // detail:{
  //   minHeight: "100vh",
  //   backgroundColor: colors.background,
  //   paddingBottom: "72px",
  //   position: "relative", // 背景层（absolute）的定位基准
  // },
  // bg: {
  //   position: "absolute",
  //   top: 0,
  //   left: 0,
  //   right: 0,
  //   height: "50vh", // 只占首屏上半（跟随内容滚动，滚出视口自然消失）
  //   overflow: "hidden",
  //   pointerEvents: "none", // 纯装饰：不挡交互
  //   zIndex: 0,
  // },
  // bgImg: {
  //   width: "100%",
  //   height: "50vh",
  //   objectFit: "cover",
  //   filter: "blur(40px)",
  //   transform: "scale(1.15)", // 防模糊边缘露出底色
  //   opacity: 0.2, // 整体透明度 20%
  // },
  // bgGradient: {
  //   position: "absolute",
  //   inset: 0,
  //   // 顶部渐变遮罩：从顶到底——0% 处背景色 80% 显示（明显遮罩，图被盖住大半），
  //   // 50% 处 0%（全透明），下半程完全露出背景图。顶部融入页面背景、向下平滑过渡。
  //   // 20% 强度视觉几乎不可见（背景色只混入 1/5）；80% 让渐变清晰。
  //   // 不用 linear-gradient(背景色) 模板——stylex 编译期无法解析模板内引用的跨文件 var
  //   // backgroundColor: colors.background,
  //   maskImage: "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 10%)",
  //   WebkitMaskImage: "linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 10%)",
  // },
  // // 内容层（containerLg 网格内）：盖在背景之上
  // content: {
  //   position: "relative",
  //   zIndex: 1,
  //   paddingTop: dimensions.spacing8,
  //   paddingBottom: dimensions.spacing12,
  // },
  // // 封面列：span 4 通用（移动 4 列全宽 / 平板 8 列占 4 / 桌面 12 列占 4）
  // coverCol: {
  //   gridColumn: "span 4",
  //   position: "relative", // 播放按钮（PlayButton）覆盖右下角
  //   minWidth: 0,
  // },
  // // 播放按钮槽：封面右下角（固定尺寸 + flex——与 episode-card 的 btnSlot 同构：
  // // 槽高不随内容类型变化，三态按钮位置恒定）
  // coverBtnSlot: {
  //   position: "absolute",
  //   right: dimensions.spacing3,
  //   bottom: dimensions.spacing3,
  //   zIndex: 1,
  //   width: dimensions.sizeLg,
  //   height: dimensions.sizeLg,
  //   display: "flex",
  //   alignItems: "flex-end",
  //   justifyContent: "flex-end",
  // },
  // // 内容列：移动 4 列全宽（自动折行）→ 平板 4 列（与封面并列）→ 桌面 8 列
  // detailCol: {
  //   gridColumn: "span 4",
  //   minWidth: 0,
  //   [DESKTOP]: {
  //     gridColumn: "span 8",
  //   },
  // },
  // notFound: {
  //   maxWidth: "720px",
  //   margin: "0 auto",
  //   padding: dimensions.spacing12,
  //   color: colors.neutral,
  //   textAlign: "center",
  // },

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
  const { t } = useI18n();
  const params = useParams<{ slug: string }>();
  // const [coverHover, setCoverHover] = createSignal(false);
  // deferStream:true → SSR 端该资源注册为 blocking promise：shell（含 head）等数据解析
  // 后才输出，Suspense 内重渲染的 Title/Meta（og:title / og:image / og:description）已注册进
  // head —— 社交爬虫读 SSR HTML 即拿到节目标题与封面。stream 模式默认不等待（fallback 先
  // flush、head 只含兜底 <title>Dailog</title>），分享卡片会缺失标题和封面。
  const data = createAsync(() => getEpisodeCached(params.slug), { deferStream: true });
  const ep = () => data();
  const navigate = useNavigate();

  // ─────────────────────────────────────────────────────────────
  // 统计数据 / 互动状态：全部在页面顶层异步加载（createResource），
  // 不拆到子组件——SSR/客户端创建顺序一致，hydration key 稳定。
  // 公开统计（点赞数/收听/完播）：SSR 有数据即同步进 HTML，客户端复用。
  // ─────────────────────────────────────────────────────────────
  interface EpisodeStats { plays: number; completions: number; likes: number }
  const [stats, { refetch: refetchStats }] = createResource(
    () => ep()?.id ?? null,
    async (id) => {
      const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/${id}/stats`);
      return r.ok ? ((await r.json()) as EpisodeStats) : null;
    },
  );
  // 点赞状态（登录态端点；SSR 无 cookie 必然 401 → 客户端 hydration 后加载）
  const [interactions, { refetch: refetchInteractions }] = createResource(
    () => (typeof window === "undefined" ? null : ep()?.id ?? null),
    async (id) => {
      const r = await fetch(`/v1/episodes/${id}/interactions`);
      return r.ok ? ((await r.json()) as { liked: boolean; likes: number }) : null;
    },
  );
  // liked 用 interactions.latest（不挂起）：like 切换后 refetchInteractions 期间保持旧值，
  // 否则 read() 在 Suspense 边界内会使整页挂起闪骨架屏（与下方 stats 同因，见播放闪屏注释）
  const liked = () => !!interactions.latest?.liked;

  // 本集开始播放 → 延迟 ~600ms 重拉统计（play 上报落库后再取，数字即时刷新；
  // reportStat 是 fire-and-forget，立即 refetch 可能抢在上报前读到旧值）
  const { current: pbCurrent, playing } = usePlayback();
  createEffect(() => {
    const cur = pbCurrent();
    if (cur?.id === ep()?.id && playing()) {
      const timer = setTimeout(() => void refetchStats(), 600);
      onCleanup(() => clearTimeout(timer));
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 交互函数（点赞 / 添加到列表 / 分享）：直接绑定到下方按钮
  // ─────────────────────────────────────────────────────────────
  const loginUrl = () =>
    `/login?redirect=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`;
  /** 401 → 跳登录页，返回 true（调用方直接 return） */
  const redirectIf401 = (res: Response): boolean => {
    if (res.status === 401) {
      navigate(loginUrl());
      return true;
    }
    return false;
  };

  const [busyLike, setBusyLike] = createSignal(false);
  const toggleLike = async () => {
    if (busyLike() || !ep()) return;
    setBusyLike(true);
    try {
      const res = await fetch(`/v1/episodes/${ep()!.id}/like`, {
        method: liked() ? "DELETE" : "POST",
      });
      if (redirectIf401(res)) return;
      if (res.ok) {
        refetchInteractions();
        refetchStats();
      }
    } finally {
      setBusyLike(false);
    }
  };

  // 分享弹窗（受控：按钮在下方 actionOutter，弹窗 UI 复用 ShareDialog）
  const [shareOpen, setShareOpen] = createSignal(false);
  // 加入播放列表弹窗（受控：按钮在下方 actionOutter，面板复用 AddToPlaylistDialog）
  const [listOpen, setListOpen] = createSignal(false);

  // 标题区元信息：主持人 · 日期 · 播放/完播统计
  const hostName = () => ep()?.callName ?? ep()?.displayName ?? ep()?.username ?? "";
  const pubDate = () => {
    const p = ep()?.publishedAt;
    return p ? new Date(p).toLocaleDateString("zh-CN") : "";
  };

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

  // 队列统一由全局播放器初始化（recommended 由 PlaybackProvider 拉取并全局灌入）。
  // 注意：此处**不要**用 createEffect 把本页节目 focusEpisode 顶到队首——focusEpisode
  // 会 replaceQueue → 队列变化 → provider 的 recommended effect 又换回推荐列表 → 本
  // effect 再顶回来，形成无限循环（每次 replaceQueue 都 loadEpisode 重置当前节目，
  // 播放条/卡片被反复刷回推荐首集）。play() 的直接切换已覆盖一切：点播放即 loadEpisode
  // 目标节目并原子更新 currentEp，无需预先把节目放进队首。

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
    // <div {...stylex.props(layouts.page,styles.detail)}>
    //   {/* 兜底标题：数据未就绪/404 时 head 也有 title（Suspense 内数据到达后 cascading 替换） */}
    //   <Title>dailog</Title>
    //   {/* OG 标签：社交分享卡片（og:image = 封面，各平台抓取展示）。
    //       ⚠️ 必须在 Suspense 内（数据就绪后）渲染——SSR 端 injectAssets 在渲染完成、shell
    //       输出前执行，挂起期间注册的 fallback 会被真实数据替换；放 Suspense 外则 head
    //       永远只有空值（社交爬虫读原始 HTML 拿不到标题/封面）。 */}
    //   <Suspense fallback={<DetailSkeleton />}>
    //   <Show
    //     when={ep()}
    //     fallback={<div {...stylex.props(styles.notFound)}>{t("episode.notFound")}</div>}
    //   >
    //     <Title>{ep()!.title || "dailog"}</Title>
    //     <Meta property="og:title" content={ep()!.title || "dailog"} />
    //     <Meta property="og:type" content="article" />
    //     <Meta property="og:url" content={`${env.siteBaseUrl}/episode/${ep()!.slug ?? ""}`} />
    //     <Meta property="og:description" content={ep()!.description?.slice(0, 200) || ""} />
    //     <Show when={ep()!.coverUrl && episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
    //       <Meta property="og:image" content={episodeCoverUrl(ep()!.id, ep()!.coverUrl)!} />
    //     </Show>
    //     {/* 背景装饰：小号封面图全屏铺底（fixed 视口固定）——模糊 + 上下渐变 + 20% 透明度 */}
    //     <div {...stylex.props(styles.bg)} aria-hidden="true">
    //       <Show when={ep()!.coverUrl && episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
    //         <img
    //           src={episodeCoverUrl(ep()!.id, ep()!.coverUrl, 320)!}
    //           alt=""
    //           {...stylex.props(styles.bgImg)}
    //         />
    //       </Show>
    //       <div {...stylex.props(styles.bgGradient)} />
    //     </div>
    //     {/* 内容：containerLg 网格（移动封面 4 列 + 内容 4 列折行；平板 4+4 并列；桌面 4+8 并列） */}
    //     <div {...stylex.props(layouts.containerLg, styles.content)}>
    //       <div
    //         {...stylex.props(styles.coverCol)}
    //         onPointerEnter={() => setCoverHover(true)}
    //         onPointerLeave={() => setCoverHover(false)}
    //       >
    //         <Cover episode={asQueue(ep()!)} />
    //         <div {...stylex.props(styles.coverBtnSlot)}>
              // <PlayButton
              //   episode={asQueue(ep()!)}
              // />
    //         </div>
    //       </div>
    //       <div {...stylex.props(styles.detailCol)}>
    //         <EpisodeDetail episode={asQueue(ep()!)} />
    //       </div>
    //     </div>
    //   </Show>
    //   </Suspense>
    // </div>
    <div {...stylex.props(layouts.page,styles.page)}>
      <Title>Dailog</Title>
      {/* fallback 包 NoHydration：客户端挂起渲染骨架时跳过 hydration 匹配
          （SSR 端资源等待后输出真实内容，从不输出骨架）——消除 Hydration Mismatch */}
      <Suspense fallback={<NoHydration><DetailSkeleton /></NoHydration>}>
        <Show
          when={ep()}
          fallback={<div>{t("episode.notFound")}</div>}
        >
          <Title>{ep()!.title || "dailog"}</Title>
          <Meta property="og:title" content={ep()!.title || "dailog"} />
          <Meta property="og:type" content="article" />
          <Meta property="og:url" content={`${env.siteBaseUrl}/episode/${ep()!.slug ?? ""}`} />
          <Meta property="og:description" content={ep()!.description?.slice(0, 200) || ""} />
          <Show when={ep()!.coverUrl && episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
            <Meta property="og:image" content={episodeCoverUrl(ep()!.id, ep()!.coverUrl)!} />
          </Show>
          {/* X/Twitter 卡片：summary_large_image 让封面大图展示（无 twitter 标签时 X 回退 og:*,
              但大图卡片需要显式声明） */}
          <Meta name="twitter:card" content="summary_large_image" />
          <Meta name="twitter:title" content={ep()!.title || "dailog"} />
          <Meta name="twitter:description" content={ep()!.description?.slice(0, 200) || ""} />
          <Show when={ep()!.coverUrl && episodeCoverUrl(ep()!.id, ep()!.coverUrl)}>
            <Meta name="twitter:image" content={episodeCoverUrl(ep()!.id, ep()!.coverUrl)!} />
          </Show>

          {/* <Container>
            <GridSpan columns={4} >
              <Center {...stylex.props(styles.coverBlock)}>
                <Cover episode={asQueue(ep()!)} xstyle={styles.cover}/>
              </Center>
            </GridSpan>
            <GridSpan columns={{base:4, [constants.DESKTOP]:8}}>
              <Center xstyle={styles.heading} axis="vertical">
                <div {...stylex.props(typography.headingSm,styles.title)}>{ep()?.title}</div>
                <div>
                  <PlayButton episode={asQueue(ep()!)} appear="fill" isIconOnly={false} width={140} />
                </div>
              </Center>
              
            </GridSpan>
            <GridSpan columns="full">ffffffggg</GridSpan>
          </Container> */}

          {/* <Grid maxWidth="720px" width="100%" columns={{base:4,[constants.TABLET]:6,[constants.DESKTOP]:6}}>
            <GridSpan columns={4} >ggg</GridSpan>
            <GridSpan columns={2} >ggg</GridSpan>
          </Grid> */}

          {/* Grid/GridSpan 组件已移除——这里直接用 CSS 写布局（见 components/containers.tsx 的 Container 写法） */}
          <section {...stylex.props(styles.head, styles.grid)}>
            <div {...stylex.props(styles.titleOutter)}>
              <div {...stylex.props(typography.caption, styles.caption)}>
                {hostName()}{pubDate() ? ` · ${pubDate()}` : ""}{stats.latest ? ` · ${t("episode.plays", { count: stats.latest.plays })} · ${t("episode.completions", { count: stats.latest.completions })}` : ""}
              </div>
              <div {...stylex.props(typography.headingMd,styles.title)}>{ep()?.title}</div>
            </div>
            <div {...stylex.props(styles.coverOutter)}>
              <Cover episode={asQueue(ep()!)} xstyle={styles.cover}/>
            </div>
            <div {...stylex.props(styles.actionOutter)}>
              {/* 播放 + 点赞 + 添加到播放列表 + 分享：交互函数与数据都在本页（见组件顶部），
                  时长不随播放状态切换，按钮宽度稳定 */}
              <PlayButton episode={asQueue(ep()!)} appear="fill" isIconOnly={false} width={96} label="duration" />
              <Button
                icon={<Icon icon={liked() ? "mdi:heart" : "mdi:heart-outline"} width={20} />}
                appear="outline"
                size="lg"
                round="full"
                label={liked() ? t("episode.liked") : t("episode.like")}
                tooltip={liked() ? t("episode.liked") : t("episode.like")}
                xstyle={liked() ? styles.likeActive : undefined}
                isDisabled={busyLike()}
                onClick={toggleLike}
              >
                {stats.latest?.likes ?? 0}
              </Button>
              <Button
                isIconOnly
                icon={<Icon icon="mdi:playlist-plus" width={20} />}
                appear="outline"
                round="full"
                size="lg"
                label={t("playlist.addTo")}
                tooltip={t("playlist.addTo")}
                onClick={() => setListOpen(true)}
              />
              <Button
                isIconOnly
                icon={<Icon icon="mdi:share-variant" width={20} />}
                appear="outline"
                size="lg"
                round="full"
                label={t("episode.share")}
                tooltip={t("episode.share")}
                onClick={() => setShareOpen(true)}
              />
            </div>
          </section>
          <section {...stylex.props(styles.main,styles.grid)}>
            <div {...stylex.props(styles.desc)}>{ep()?.description}</div>
          </section>

          {/* 弹窗：分享（渠道面板）+ 加入播放列表（列表勾选/新建）——面板抽为组件，按钮在 actionOutter */}
          <ShareDialog episode={asQueue(ep()!)} isOpen={shareOpen()} onOpenChange={setShareOpen} />
          <AddToPlaylistDialog episodeId={ep()!.id} isOpen={listOpen()} onOpenChange={setListOpen} />

        </Show>
      </Suspense>
    </div>
  );
}