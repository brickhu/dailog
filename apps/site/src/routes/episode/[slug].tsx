import { For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { A, createAsync, useNavigate, useParams } from "@solidjs/router";
import { Link, Meta, Title } from "@solidjs/meta";
import { Cover } from "../../components/cover";
import { PlayButton } from "../../components/play-button";
import { ShareDialog } from "../../components/share-buttons";
import { fetchFavoriteStatus, setFavorite } from "../../lib/favorites";
import { usePlayback, type QueueEpisode } from "../../lib/playback";
import { getEpisodeCached } from "../../lib/episode-cache";
import { createClientValue } from "../../lib/client-value";
import type { EpisodeSummary } from "../../lib/db";
import { apiBaseForFetch, env, episodeCoverUrl } from "../../lib/env";
import { fmtDateTime, fmtDuration } from "../../lib/format";
import * as stylex from "@stylexjs/stylex";
import { layouts, typography, shadows, dimensions, colors, global } from "@dailogues/ui/theme.stylex";
import { Avatar, Badge, Button, Icon, MetadataList, MetadataListItem } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import "../../lib/auth-guard"; // 副作用：registerDirective("auth", …) —— use:auth 指令依赖它
import { Page } from "../../layouts/page";
import { Block, Container } from "../../layouts/container";



// 详情页（传统博客式）：dailog.fm/<episode_id> —— SSR 渲染（可索引/分享）。
// 布局：封面（左/上，内嵌播放控件）+ 详情（右/下）；播放由全局播放条贯通，
// 进入时节目进队列首位 + 推荐填充（播完自动连播下一期）。
// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）

const TABLETANDDESKTOP = "@media (min-width: 640px)"

const css = stylex.create({
  page: {
    minHeight: "100vh",
    paddingBlock: dimensions.spacing4,
    gap: dimensions.spacing8,
    [TABLETANDDESKTOP]: {
      paddingBlock: dimensions.spacing12,
    }
  },
  container: {

  },
  side: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap : dimensions.spacing6
    
  },
  main: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap : dimensions.spacing6
  },
  cover:{
    width : "100%",
    boxShadow: shadows.shadowMed,
    borderRadius : dimensions.radiusMd,
    aspectRatio : "1/1",
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.surface
  },
  titleOutter : {
    display: "flex",
    flexDirection : "column",
    gap: dimensions.spacing2
  },
  caption: {
    opacity : "60%",
    display: "flex",
    alignItems : "center",
    gap : dimensions.spacing1,
    fontWeight : dimensions.fontWeightSemiBold
  },
  creatorLink : {
    textDecoration : "none"
  },
  desc: {
    
  },
  actions: {
    display : "flex",
    alignItems : "center",
    justifyContent : "space-between",
    gap : dimensions.spacing2,
    width: "100%"
  },
  playerActions:{
    display : "flex",
    alignItems : "center",
    gap : dimensions.spacing2
  },
  otherActions: {
    display : "flex",
    alignItems : "center",
    gap : dimensions.spacing2
  },
  highline:{
    opacity: "0.8",
    fontStyle: "italic",
  },
  highlights: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    
  
  },
  highlight: {
    margin: 0,
    borderLeft: `2px solid ${colors.primaryWeak}`,
    display: "relative",
    fontStyle: "italic",
    color: `color-mix(in srgb, currentColor 60%, transparent)`,
    '::before': {
      content: `"“"`,
      paddingRight: dimensions.spacing2,
      top: `-10px`,
      display: 'absolute',
      whiteSpace: "nowrap",
      fontSize: dimensions.fontSize2xl,
    },
  },
  credit: {
    marginTop: dimensions.spacing5,
    color: colors.primaryWeak,
    lineHeight: 1.7,
  },
  // 演职员行（金句上方）：[头像][主播 badge] 采访 [头像][AI 嘉宾 badge]
  cast: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: dimensions.spacing2,
  },
  castPerson: {
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing1,
    backgroundColor: colors.surfaceWeak,
    padding: `${dimensions.spacing1} ${dimensions.spacing1}`,
    borderRadius: dimensions.radiusFull,
    fontSize: dimensions.fontSizeSm,
  },
  castVerb: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  refs: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    paddingTop: dimensions.spacing5,
    borderColor: colors.surface,
    borderTopWidth: dimensions.borderWidthThin,
    borderTopStyle: "solid",
    width: "100%",
  },
  refItem: {
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    lineHeight: 1.6,
    "::before": {
      content: `"*"`,
      paddingRight: dimensions.spacing2,
    }
  },
  refItemTd: {
    fontWeight: dimensions.fontWeightBold,
  },
   tags: {
    display: "flex",
    flexWrap: "wrap",
    gap: dimensions.spacing2,
  },


})



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
  // liked 经 createClientValue 读（effect 内读 → 不挂起页面级 Suspense）：interactions
  // 是登录态端点、SSR 端 source 短路为 null（服务端没有序列化）→ 客户端 hydration 期
  // 该资源处于 pending，若在渲染期直接读 .latest 会把 pages/layouts 的 Suspense 打进
  // fallback → Hydration Mismatch（根因见 lib/client-value.ts）。
  // 副作用同前：like 切换后 refetchInteractions 期间保持旧值，不使整页挂起闪骨架屏。
  const liked = createClientValue(() => interactions.latest?.liked, false);

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
  // favorited 经 createClientValue 读（同 liked：客户端专属资源不能在渲染期读，
  // 否则 hydration 期页面级 Suspense fallback → mismatch）；toggle 后 refetchFav
  // 期间保持旧值
  const favorited = createClientValue(() => fav.latest?.contains, false);

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
  // 本期 AI 嘉宾名称（无嘉宾节目回退主播名——文案「用户与{guest}的原始对话」仍通顺）
  const guestName = () => ep()?.guest?.name ?? hostName();
  // 发布时间：日期 + 时间（跟随当前语言；时区固定为展示时区，见 lib/format 的 DISPLAY_TIME_ZONE）
const pubDate = () => fmtDateTime(ep()?.publishedAt, locale() === "zh" ? "zh-CN" : "en-US");
// 「节目信息」分类：后端枚举（insight/experience/advice/inspiration）→ 本地 i18n 文案；
// 未知值原样显示（将来枚举扩充时不会显示空白）
const CATEGORY_KEYS = ["insight", "experience", "advice", "inspiration"] as const;
const categoryLabel = () => {
  const c = ep()?.category;
  if (!c) return "—";
  return (CATEGORY_KEYS as readonly string[]).includes(c)
    ? t(`episode.category.${c}` as never)
    : c;
};
// 节目语言：显示名走 i18n lang.<code>（中文 / English…）；未知码原样显示
const LANGUAGE_KEYS = ["zh", "en"] as const;
const languageLabel = () => {
  const l = ep()?.language;
  if (!l) return "—";
  return (LANGUAGE_KEYS as readonly string[]).includes(l)
    ? t(`lang.${l}` as never)
    : l;
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
    console.log("节目信息",e)
    if (typeof window !== "undefined" && e && e.slug !== params.slug) {
      window.location.replace(`/episode/${e.slug}`);
    }
  });

  // ── 分享卡片 / SEO 元信息 ──────────────────────────────────────────────
  // 社交爬虫不执行 JS，只读 SSR 首帧的 head（entry-server 的 deferStream 保证数据解析
  // 后才 flush，见上方注释）。字段缺失会直接毁掉卡片：X 没有 twitter:card 会退化成
  // 纯链接；微信/微博/Slack 没有 description 只剩一行标题；没有图就没有缩略图。
  // 封面走 API 的 ?w=960 出图（R2 原图 1400² 约 690KB，对爬虫过重；外链封面
  // episodeCoverUrl 会忽略 w 直用原 URL）。无封面兜底站点图标——宁可小图也不要无图。
  const shareUrl = () => `${env.siteBaseUrl}/episode/${ep()!.slug ?? ""}`;
  const shareTitle = () => ep()!.title || "dailog";
  const shareDesc = () =>
    (ep()?.summary || ep()?.description || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const shareImage = () =>
    episodeCoverUrl(ep()!.id, ep()!.coverUrl, 960) ?? `${env.siteBaseUrl}/icons/icon-512.png`;

  return (

    <Show when={ep()} fallback={<div>{t("episode.notFound")}</div>}>
      <Title>{shareTitle()}</Title>
      <Meta name="description" content={shareDesc()} />
      <Link rel="canonical" href={shareUrl()} />

      <Meta property="og:site_name" content="dailog" />
      <Meta property="og:type" content="article" />
      <Meta property="og:title" content={shareTitle()} />
      <Meta property="og:description" content={shareDesc()} />
      <Meta property="og:url" content={shareUrl()} />
      <Meta property="og:image" content={shareImage()} />
      <Meta property="og:image:alt" content={shareTitle()} />
      <Meta property="og:locale" content={ep()!.language === "en" ? "en_US" : "zh_CN"} />

      {/* 封面是 1:1 方图 → summary（方缩略图，不裁切）；换横幅图再改 summary_large_image */}
      <Meta name="twitter:card" content="summary" />
      <Meta name="twitter:title" content={shareTitle()} />
      <Meta name="twitter:description" content={shareDesc()} />
      <Meta name="twitter:image" content={shareImage()} />
    
    
    <Page xstyle={css.page}>
      <Container xstyle={css.container}>
        <Block cols="1/3" xstyle={css.side}>
          <Show when={ep()}>
            <Cover episode={asQueue(ep()!)} xstyle={css.cover}/>
            
            <div {...stylex.props(css.titleOutter)}>
              <div {...stylex.props(typography.caption, css.caption)}>
                <Show when={ep()!.number}>
                  <span>{t("episode.number", { n: ep()!.number! })}</span>
                </Show>
                <Show when={ep()!.durationSeconds}>
                  <span> · </span>
                  <span>{fmtDuration(ep()!.durationSeconds, true)}</span>
                </Show>
    
              </div>
              <div {...stylex.props(typography.headingMd)}>{ep()?.title}</div>
            </div>

            <div {...stylex.props(css.actions)}>
              <div {...stylex.props(css.playerActions)}>
                  <PlayButton episode={asQueue(ep()!)} appear="fill" isIconOnly={true} />
                  <Show when={stats.latest}>
                    <span {...stylex.props(typography.caption)}>{stats.latest!.plays} plays</span>
                  </Show>
              </div>
              
              <div {...stylex.props(css.otherActions)}>
                <Button
                  icon={liked() ? <Icon icon="material-symbols:thumb-up" width={20} />:<Icon icon="material-symbols:thumb-up-outline" width={20} /> }
                  appear="ghost"
                  round="full"
                  use:auth={true}
                  label={liked() ? t("episode.liked") : t("episode.like")}
                  tooltip={liked() ? t("episode.liked") : t("episode.like")}
                  isDisabled={busyLike()}
                  onClick={toggleLike}
                >
                  {stats.latest?.likes ?? 0}
                </Button>
                <Button
                  isIconOnly
                  icon={favorited() ? <Icon icon="mdi:bookmark" width={20} />:<Icon icon="mdi:bookmark-outline" width={20}/>}
                  appear="ghost"
                  round="full"
                  use:auth={true}
                  label={favorited() ? t("favorite.added") : t("favorite.add")}
                  tooltip={favorited() ? t("favorite.added") : t("favorite.add")}
                  isDisabled={busyFav()}
                  onClick={toggleFavorite}
                />
                <Button
                  isIconOnly
                  icon={<Icon icon="mdi:share-variant" width={20} />}
                  appear="ghost"
                  round="full"
                  label={t("episode.share")}
                  tooltip={t("episode.share")}
                  onClick={() => setShareOpen(true)}
                />
              </div>
            </div>
          </Show>
        </Block>
        {/* Main Content */}
        <Block cols={7} start={6} xstyle={css.main}>
          {/* 演职员：[头像][主播] 采访 [头像][AI 嘉宾] —— 两个名字都是可点击 badge
              （主播 → /@username 频道页；嘉宾 → /guest/:id）。无嘉宾的节目只显示主播。 */}
          <div {...stylex.props(css.cast)}>
            <span {...stylex.props(css.castPerson)}>
              <Avatar image={ep()!.hostAvatar} name={hostName()} size={20} /> {hostName()}
            </span>
            <span {...stylex.props(css.castVerb)}>×</span>

            <span {...stylex.props(css.castPerson)}>
              <Avatar  image={ep()!.guest!.avatar} name={ep()!.guest!.name} size={20} /> {ep()!.guest!.name}
            </span>

          </div>
          {/* Highlights */}
          <Show when={ep()?.highlights?.length}>
            <div {...stylex.props(css.highlights)}>
              <For each={ep()?.highlights ?? []}>
                {(h) => <blockquote {...stylex.props(css.highlight, typography.bodyLg)}>{h.text}</blockquote>}
              </For>
            </div>
          </Show>

          {/* Description */}
          <div {...stylex.props(css.desc, typography.bodyLg)}>{ep()?.description}</div>
          {/* References */}
          <Show when={ep()?.references?.length}>
            <div {...stylex.props(css.refs)}>
              <For each={ep()?.references ?? []}>
                {(r) => (
                  <div {...stylex.props(css.refItem)}>
                    <strong {...stylex.props(css.refItemTd)}>{r.term} : </strong> {r.explanation}
                  </div>
                )}
              </For>
            </div>
          </Show>
          {/* Tags */}
          <Show when={ep()!.tags?.length}>
              <div {...stylex.props(css.tags)}>
                <For each={ep()!.tags!}>
                  {(tag) => (
                    <A href={`/tag/${encodeURIComponent(tag)}`}>
                     
                      <Badge label={tag} />
                      
                    </A>
                  )}
                </For>
              </div>
            </Show>
          {/* Info：节目元信息（值缺失显示 "—"，保持行结构稳定） */}
          <div {...stylex.props(layouts.containerFull)}>
            <MetadataList
              title={<div {...stylex.props(typography.headingXs)}>{t("episode.info.title")}</div>}
              columns={{ base: 1, [TABLETANDDESKTOP]: 2 }}
              label={{ position: "start" }}
            >
              <MetadataListItem label={t("episode.info.id")}>{ep()?.slug ?? "—"}</MetadataListItem>
              <MetadataListItem label={t("episode.info.publishedAt")}>{pubDate() || "—"}</MetadataListItem>
              <MetadataListItem label={t("episode.info.submitter")}>{ep()?.username ?? "—"}</MetadataListItem>
              <MetadataListItem label={t("episode.info.category")}>{categoryLabel()}</MetadataListItem>
              <MetadataListItem label={t("episode.info.language")}>{languageLabel()}</MetadataListItem>
              <MetadataListItem label={t("episode.info.number")}>
                {ep()?.number ? t("episode.number", { n: ep()!.number! }) : "—"}
              </MetadataListItem>
            </MetadataList>
          </div>
          {/* Credit */}
          <div {...stylex.props(typography.caption, css.credit)}>
            <span>
              {t("episode.credit.prefix")}
              <Show when={ep()?.username} fallback={<>{hostName()}</>}>
                <A href={`/@${ep()!.username}`} {...stylex.props(global.linkText)}>{ep()!.username}</A>
              </Show>
              {t("episode.credit.mid1", { guest: guestName() })}
              <Show when={ep()?.sourceUrl} fallback={<>{t("episode.credit.source")}</>}>
                <A href={ep()!.sourceUrl!} target="_blank" rel="noopener" {...stylex.props(global.linkText)}>{t("episode.credit.source")}</A>
              </Show>
              {t("episode.credit.mid2")}
              <A href="/" {...stylex.props(global.linkText)}>{t("episode.credit.submit")}</A>
              {t("episode.credit.suffix")}
            </span>
          </div>
          
        </Block>
      </Container>
    </Page>
    <ShareDialog episode={asQueue(ep()!)} isOpen={shareOpen()} onOpenChange={setShareOpen} />      
    </Show>

  );
}