import { For, Show, Suspense, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { NoHydration } from "solid-js/web";
import { A, createAsync, useNavigate, useParams } from "@solidjs/router";
import { Meta, Title } from "@solidjs/meta";
import { Cover } from "../../components/cover";
import { PlayButton } from "../../components/play-button";
import { ShareDialog } from "../../components/share-buttons";
import { fetchFavoriteStatus, setFavorite } from "../../lib/favorites";
import { DetailSkeleton } from "../../components/page-skeletons";
import { usePlayback, type QueueEpisode } from "../../lib/playback";
import { getEpisodeCached } from "../../lib/episode-cache";
import type { EpisodeSummary } from "../../lib/db";
import { apiBaseForFetch, env, episodeCoverUrl } from "../../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts, typography, shadows, dimensions, colors } from "@dailogues/ui/theme.stylex";
import { Button, ClickableCard, Icon } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { auth } from "../../lib/auth-guard";

// 详情页（传统博客式）：dailog.fm/<episode_id> —— SSR 渲染（可索引/分享）。
// 布局：封面（左/上，内嵌播放控件）+ 详情（右/下）；播放由全局播放条贯通，
// 进入时节目进队列首位 + 推荐填充（播完自动连播下一期）。
// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）

const TABLETANDDESKTOP = "@media (min-width: 640px)"

const styles = stylex.create({
  // 响应式列数（Grid 单值 columns={4}，断点覆盖走 xstyle + @media）
  page: {
    minHeight: "100vh",
    paddingBlock: dimensions.spacing4,
    gap: dimensions.spacing8,
    [TABLETANDDESKTOP]: {
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
    [TABLETANDDESKTOP]: {
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
    [TABLETANDDESKTOP]: {
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
    [TABLETANDDESKTOP]: {
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
    [TABLETANDDESKTOP]: {
      gridColumn : "span 4",
    },
  },
  title : {
     
  },
  caption: {
    opacity : "50%",

  },
  desc: {
    gridColumn : "1 / -1",
  },
  tags: {
    gridColumn: "1 / -1",
    display: "flex",
    flexWrap: "wrap",
    gap: dimensions.spacing2,
  },
  tag: {
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surfaceStrong,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    // 链接胶囊（详情页 tags → /tag/<tag> 标签检索页）：去下划线 + hover 反馈
    textDecoration: "none",
    ":hover": {
      opacity: 0.75,
    },
  },
  cast: {
    gridColumn : "1 / -1",
  },
  // 点赞激活态（已赞：红粉心形点亮）
  likeActive: {
    color: colors.danger,
  },
  // ── cast 演出阵容：主持人卡片 + 嘉宾卡片（嘉宾存在才渲染整块） ──
  castSection: {
    gridColumn: "1 / -1",
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  castLabel: {
    color: colors.neutral,
  },
  castGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: dimensions.spacing4,
  },
  // 布局交给 xstyle，视觉（surface 底 + 圆角 + hover 反馈）由 ClickableCard 提供
  personCard: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing4,
    textDecoration: "none",
    color: "inherit",
    minWidth: 0,
  },
  personAvatar: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    objectFit: "cover",
    flexShrink: 0,
  },
  personAvatarFallback: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    color: colors.background,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: dimensions.fontSize2xl,
    flexShrink: 0,
  },
  personBody: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
    minWidth: 0,
  },
  personRole: {
    color: colors.neutral,
  },
  personName: {
    fontWeight: dimensions.fontWeightBold,
    fontSize: dimensions.fontSizeLg,
    lineHeight: 1.3,
    overflowWrap: "anywhere",
  },
  personMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },

  cover:{
    maxWidth : `calc(${dimensions.size2xl} * 3)`,
    minWidth : dimensions.size2xl,
    width : "90%",
    boxShadow: shadows.shadowMed,
    borderRadius : dimensions.radiusMd
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

  // 收藏状态（登录态端点；SSR 无 cookie 必然 401 → 客户端 hydration 后加载）——
  // 与点赞同模式：createResource 拉取 + toggle 绑定下方按钮，逻辑走共享函数（lib/favorites）
  const [fav, { refetch: refetchFav }] = createResource(
    () => (typeof window === "undefined" ? null : ep()?.id ?? null),
    async (id) => fetchFavoriteStatus(id),
  );
  // favorited 用 fav.latest（不挂起）：toggle 后 refetchFav 期间保持旧值（与 liked 同因）
  const favorited = () => !!fav.latest?.contains;

  const [busyFav, setBusyFav] = createSignal(false);
  const toggleFavorite = async () => {
    if (busyFav() || !ep()) return;
    setBusyFav(true);
    try {
      const res = await setFavorite(ep()!.id, favorited());
      if (redirectIf401(res)) return;
      if (res.ok) refetchFav();
    } finally {
      setBusyFav(false);
    }
  };

  // 分享弹窗（受控：按钮在下方 actionOutter，弹窗 UI 复用 ShareDialog）
  const [shareOpen, setShareOpen] = createSignal(false);

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

     

          {/* Grid/GridSpan 组件已移除——这里直接用 CSS 写布局（见 components/containers.tsx 的 Container 写法） */}
          <section {...stylex.props(styles.head, styles.grid)}>
            <div {...stylex.props(styles.titleOutter)}>
              <div {...stylex.props(typography.caption, styles.caption)}>
                <Show when={ep()!.number}>
                  <span>{t("episode.number", { n: ep()!.number! })} · </span>
                </Show>
                <A href={"/@" + (ep()!.username ?? "")}>{"@"+ep()!.username} </A>
                {/* {hostName()}{pubDate() ? ` · ${pubDate()}` : ""}{stats.latest ? ` · ${t("episode.plays", { count: stats.latest.plays })} · ${t("episode.completions", { count: stats.latest.completions })}` : ""} */}
              </div>
              <div {...stylex.props(typography.headingMd,styles.title)}>{ep()?.title}</div>
            </div>
            <div {...stylex.props(styles.coverOutter)}>
              <Cover episode={asQueue(ep()!)} xstyle={styles.cover}/>
            </div>
            <div {...stylex.props(styles.actionOutter)}>
              {/* 播放 + 点赞 + 收藏 + 分享：交互函数与数据都在本页（见组件顶部），
                  时长不随播放状态切换，按钮宽度稳定 */}
              <PlayButton episode={asQueue(ep()!)} appear="fill" isIconOnly={false} width={96} label="duration" />
              <Button
                icon={liked() ? <Icon icon="material-symbols:thumb-up" width={20} />:<Icon icon="material-symbols:thumb-up-outline" width={20} /> }
                appear={liked()?"fill":"outline"}
                size="lg"
                round="full"
                use:auth={true}
                label={liked() ? t("episode.liked") : t("episode.like")}
                tooltip={liked() ? t("episode.liked") : t("episode.like")}
                // xstyle={liked() ? styles.likeActive : undefined}
                isDisabled={busyLike()}
                onClick={toggleLike}
              >
                {stats.latest?.likes ?? 0}
              </Button>
              <Button
                isIconOnly
                icon={favorited() ? <Icon icon="mdi:bookmark" width={20} />:<Icon icon="mdi:bookmark-outline" width={20}/>}
                appear={favorited() ? "fill":"outline"}
                round="full"
                size="lg"
                use:auth={true}
                label={favorited() ? t("favorite.added") : t("favorite.add")}
                tooltip={favorited() ? t("favorite.added") : t("favorite.add")}
                isDisabled={busyFav()}
                onClick={toggleFavorite}
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
            <Show when={ep()!.tags?.length}>
              <div {...stylex.props(styles.tags)}>
                <For each={ep()!.tags!}>
                  {(tag) => (
                    // 标签胶囊 → 标签检索页 /tag/<tag>（中文标签 percent-encoded；A 保留链接语义）
                    <A href={`/tag/${encodeURIComponent(tag)}`} {...stylex.props(styles.tag)}>
                      #{tag}
                    </A>
                  )}
                </For>
              </div>
            </Show>
            <div {...stylex.props(styles.cast)}></div>
          </section>

          <section {...stylex.props(styles.main, styles.grid)}>
            <div {...stylex.props(styles.castSection)}>{t("episode.cast")}</div>
          </section>

           {/* cast 演出阵容：主持人 + 嘉宾卡片（无嘉宾不渲染整块） */}
          <Show when={ep()!.guest}>
            <section {...stylex.props(styles.main, styles.grid)}>
              <div {...stylex.props(styles.castSection)}>
                <div {...stylex.props(typography.caption, styles.castLabel)}>{t("episode.cast")}</div>
                <div {...stylex.props(styles.castGrid)}>
                  {/* 主持人卡片：头像 + 称呼（callName ?? displayName）+ @主页。
                      ClickableCard：href 保留 link 语义（Enter/中键/Cmd+点击），
                      onClick preventDefault 接管为 SPA 路由导航 */}
                  <ClickableCard
                    label={`${t("episode.host")} ${hostName() || ep()!.displayName}`}
                    href={"/@" + (ep()!.username ?? "")}
                    padding={3}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate("/@" + (ep()!.username ?? ""));
                    }}
                    xstyle={styles.personCard}
                  >
                    <Show
                      when={ep()!.hostAvatar}
                      fallback={<div {...stylex.props(styles.personAvatarFallback)}>{(hostName() || "D").slice(0, 1)}</div>}
                    >
                      <img src={ep()!.hostAvatar!} alt="" {...stylex.props(styles.personAvatar)} />
                    </Show>
                    <div {...stylex.props(styles.personBody)}>
                      <div {...stylex.props(typography.caption, styles.personRole)}>{t("episode.host")}</div>
                      <div {...stylex.props(styles.personName)}>{hostName() || ep()!.displayName}</div>
                      <div {...stylex.props(styles.personMeta)}>{"@" + (ep()!.username ?? "")}</div>
                    </div>
                  </ClickableCard>
                  {/* 嘉宾卡片：头像 + 名称 + 平台，链接嘉宾主页（同上，ClickableCard + SPA 接管） */}
                  <ClickableCard
                    label={`${t("episode.guest")} ${ep()!.guest!.name}`}
                    href={"/guest/" + ep()!.guest!.id}
                    padding={3}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate("/guest/" + ep()!.guest!.id);
                    }}
                    xstyle={styles.personCard}
                  >
                    <Show
                      when={ep()!.guest!.avatar}
                      fallback={<div {...stylex.props(styles.personAvatarFallback)}>{ep()!.guest!.name.slice(0, 1)}</div>}
                    >
                      <img src={ep()!.guest!.avatar!} alt="" {...stylex.props(styles.personAvatar)} />
                    </Show>
                    <div {...stylex.props(styles.personBody)}>
                      <div {...stylex.props(typography.caption, styles.personRole)}>{t("episode.guest")}</div>
                      <div {...stylex.props(styles.personName)}>{ep()!.guest!.name}</div>
                      <div {...stylex.props(styles.personMeta)}>{ep()!.guest!.platform}</div>
                    </div>
                  </ClickableCard>
                </div>
              </div>
            </section>
          </Show>

          {/* 弹窗：分享（渠道面板）+ 加入播放列表（列表勾选/新建）——面板抽为组件，按钮在 actionOutter */}
          <ShareDialog episode={asQueue(ep()!)} isOpen={shareOpen()} onOpenChange={setShareOpen} />

        </Show>
      </Suspense>
    </div>
  );
}