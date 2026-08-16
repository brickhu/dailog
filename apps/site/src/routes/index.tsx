import { createEffect, createResource, createSignal, Show, For } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { apiBaseForFetch, episodeCoverUrl } from "../lib/env";
import { getEpisodeCached } from "../lib/episode-cache";
import { Faq } from "../components/faq";
import { Button, Icon } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { layouts, typography } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { auth } from "../lib/auth-guard";
// use:auth 指令的作用域绑定（babel 编译转换需要；TS 不识 JSX 指令故 void 消除未使用误报）
void auth;

// 首页（传统博客式）：hero 品牌区 + 推荐节目滚屏。
// 播放由全局播放条（PlayerBar）接管——点卡片播放按钮即入队连播，播完自动切下一期；
// 点卡片进详情页（/<episode_id>）。列表数据 = 推荐队列 API（热度分排序 + 语言优先）。
// 推荐区滚屏：每屏 4 条（移动端 2×2）、最多 5 屏（limit=20），末屏不足 4 条灰块补齐；
// 异步加载期间骨架屏占位（透明度脉冲，颜色跟随 surface token 自动适配暗色模式）。
// 注意：keyframes 须在 create 内内联（stylex 0.19 插件对模块级 keyframes const 求值报错）

const styles = stylex.create({

  hero: {
    // padding: `${dimensions.spacing12} ${dimensions.spacing8} ${dimensions.spacing8}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    gridColumn: "span 7",
    paddingTop: dimensions.spacing12,
  },
  tagline: {
    margin: 0,
  },
  what: {
    color: colors.foreground,
    margin: 0,
  },
  ctaHint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  ctaRow: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    alignItems: "flex-start",
    flexWrap: "wrap",
    paddingTop: dimensions.spacing3,
  },
  cta: {
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    width: "fit-content",
    padding: `${dimensions.spacing3} ${dimensions.spacing6}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    fontWeight: dimensions.fontWeightMedium,
    textDecoration: "none",
    fontSize: dimensions.fontSizeMd,
  },

  listTitleRow: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing8} ${dimensions.spacing8} ${dimensions.spacing4}`,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    "@media (max-width: 640px)": {
      padding: `${dimensions.spacing6} ${dimensions.spacing4} ${dimensions.spacing3}`,
    },
  },
  listTitle: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
  },
  moreLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.primary },
  },
  // ---- 推荐滚屏：视口 + 平移轨道 + 分页 ----
  viewport: {
    maxWidth: "1080px",
    margin: "0 auto",
    // 无左右内边距：overflow 裁剪边界 = 容器边缘，相邻分页的卡片不会从 padding 区露出
    padding: `0 0 ${dimensions.spacing2}`,
    overflow: "hidden",
    "@media (max-width: 640px)": {
      padding: `0 0 ${dimensions.spacing2}`,
    },
  },
  track: {
    display: "flex",
    transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  pagePane: {
    flex: "0 0 100%",
    minWidth: "100%",
    // 左右内边距在分页内部：卡片与标题行同宽，且下一屏从容器边缘外才开始
    padding: `0 ${dimensions.spacing8}`,
    display: "grid",
    // minmax(0,1fr)：1fr 默认有 min-content 下限，长标题卡片会把轨道撑宽导致第 4 张被裁掉
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: dimensions.spacing5,
    "@media (max-width: 640px)": {
      padding: `0 ${dimensions.spacing4}`,
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: dimensions.spacing4,
    },
  },
  grayBlock: {
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface, // 与卡片同底色的灰块占位
  },
  // ---- 分页控制：‹ 圆点 › ----
  controls: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing3} ${dimensions.spacing8} ${dimensions.spacing12}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": {
      padding: `${dimensions.spacing3} ${dimensions.spacing4} ${dimensions.spacing8}`,
      gap: dimensions.spacing3,
    },
  },
  navBtn: {
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface,
    color: colors.foreground,
    fontSize: "20px",
    lineHeight: 1,
    cursor: "pointer",
    ":hover": { backgroundColor: colors.surfaceStrong },
    ":disabled": { opacity: 0.35, cursor: "default" },
  },
  dots: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
  },
  dot: {
    width: "8px",
    height: "8px",
    padding: 0,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surfaceStrong,
    cursor: "pointer",
    ":hover": { backgroundColor: colors.neutral },
  },
  dotActive: {
    backgroundColor: colors.brand,
    ":hover": { backgroundColor: colors.brand },
  },
  // ---- 骨架屏（异步加载占位）：与真实卡片同尺寸，透明度脉冲 ----
  skeletonGrid: {
    maxWidth: "1080px",
    margin: "0 auto",
    // 与滚屏一致：左右内边距与标题行对齐
    padding: `0 ${dimensions.spacing8} ${dimensions.spacing12}`,
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: dimensions.spacing5,
    "@media (max-width: 640px)": {
      gridTemplateColumns: "repeat(2, 1fr)",
      padding: `0 ${dimensions.spacing4} ${dimensions.spacing8}`,
      gap: dimensions.spacing4,
    },
  },
  skeletonCard: {
    // 复用 card 的底板/内边距，仅占位不可点击
  },
  skeletonBlock: {
    backgroundColor: colors.surface,
    animationName: stylex.keyframes({
      from: { opacity: 0.55 },
      to: { opacity: 1 },
    }),
    animationDuration: "0.9s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
  skeletonCover: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusSm,
  },
  skeletonLine: {
    height: "14px",
    borderRadius: dimensions.radiusSm,
  },
  skeletonLineTitle: {
    width: "70%",
  },
  skeletonBtn: {
    width: "56px",
    height: "24px",
    borderRadius: dimensions.radiusFull,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    padding: dimensions.spacing3,
    cursor: "pointer",
    alignSelf: "flex-start", // 卡片不被网格行拉伸：不同高度的分页互不影响，避免空卡片被撑成大片空白
    ":hover": { borderColor: colors.primary },
  },
  cover: {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: dimensions.radiusSm,
  },
  // 无封面节目：封面占位块（灰底 + 播客图标），保持卡片结构完整
  coverFallback: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "40px",
    color: colors.neutral,
    userSelect: "none",
  },
  title: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  playBtn: {
    alignSelf: "flex-start",
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: colors.brandStrong,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
  },
  playBtnActive: {
    backgroundColor: colors.brand,
    color: colors.onBrand,
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    flexWrap: "wrap",
  },
  playingTime: {
    color: colors.neutral,
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  statCards: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `0 ${dimensions.spacing8} ${dimensions.spacing12}`,
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": {
      gridTemplateColumns: "1fr",
      padding: `0 ${dimensions.spacing4} ${dimensions.spacing8}`,
    },
  },
  statCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing2,
    minHeight: "160px",
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusLg,
    backgroundColor: colors.surface, // 与节目卡片统一灰
    textDecoration: "none",
    color: "inherit",
    textAlign: "center",
    ":hover": { borderColor: colors.primary },
  },
  statTitle: {
    fontSize: "20px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.foreground,
  },
  statLogo: {
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  statLogoFallback: {
    width: "52px",
    height: "52px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
    color: colors.foreground,
  },
  statLogos: {
    display: "flex",
    gap: dimensions.spacing2,
    alignItems: "center",
  },
  statLogoSmall: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover",
  },
  statLogoFallbackSmall: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    backgroundColor: colors.ink,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    color: colors.foreground,
  },
  statTags: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: dimensions.spacing2,
  },
  statTag: {
    padding: "2px 10px",
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surface, // 与节目卡片同色（surface 底 + ink 描边）
    fontSize: "13px",
    color: colors.foreground,
  },
  statText: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function HomePage() {
  const { t, locale } = useI18n();
  const playback = usePlayback();
  const navigate = useNavigate();
  const [page, setPage] = createSignal(0); // 推荐滚屏当前页

  // 数据加载统一 createResource（内置 loading/error 状态，各自独立并行）：
  // 推荐队列（热度分 + 语言优先，每屏 4 条 × 最多 5 屏 → limit=20）
  // 推荐队列：SSR 时服务端 fetch（http 基址，数据序列化进 HTML），客户端 hydration 直接用
  const [list] = createResource(async () => {
    const lang = locale() === "en" ? "en" : "zh";
    const r = await fetch(`${apiBaseForFetch}/v1/public/episodes/recommended?lang=${lang}&limit=20`);
    const eps: unknown = r.ok ? await r.json() : null;
    return Array.isArray(eps) && eps.length > 0 ? (eps as QueueEpisode[]) : null;
  });
  // 播放器队列：数据到达时初始化（未激活才灌入，不打断播放）；新数据回第一屏
  createEffect(() => {
    const eps = list();
    if (!eps) return;
    setPage(0);
    if (!playback.activated()) playback.setQueue(eps);
  });
  // 站点头部数据（三个统计卡片）
  const [stats] = createResource(async () => {
    const r = await fetch(`${apiBaseForFetch}/v1/public/stats`);
    return r.ok ? await r.json() : null;
  });
  const [guestLogos] = createResource(async () => {
    const r = await fetch(`${apiBaseForFetch}/v1/public/guests`);
    const d: unknown = r.ok ? await r.json() : null;
    return Array.isArray(d) ? (d as Array<{ name: string; avatar: string | null }>).slice(0, 4) : [];
  });

  const hostName = (ep: QueueEpisode) => ep.callName ?? ep.displayName ?? ep.username;
  // 当前播放中的节目：卡片显示「暂停」+ 已播放时间（进度由全局播放器驱动）
  const isCurrent = (id: string) => playback.current()?.id === id;
  const fmt = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  // 推荐滚屏分页：每屏 4 条、最多 5 屏；末屏不足 4 条由灰块补齐
  const PAGE_SIZE = 4;
  const MAX_PAGES = 5;
  const pageCount = () =>
    list()?.length ? Math.min(MAX_PAGES, Math.ceil(list()!.length / PAGE_SIZE)) : 0;
  const pageIndexes = () => Array.from({ length: pageCount() }, (_, i) => i);
  const pageItems = (i: number) => list()!.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
  const curPage = () => Math.max(0, Math.min(page(), pageCount() - 1));

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerLg)}>
      <section {...stylex.props(styles.hero)}>
        <h1 {...stylex.props(typography.displayMd, styles.tagline)}>{t("home.hero.tagline")}</h1>
        <p {...stylex.props(typography.bodyXl, styles.what)}>{t("home.hero.what")}</p>
        <div {...stylex.props(styles.ctaRow)}>
          <Button
            use:auth={true}
            size="xl"
            icon={<Icon icon="mdi:send" width={16} />}
            onClick={() => navigate("/submit")}
          >
            {t("home.hero.submit")}
          </Button>
          {/* <A href="/submit" {...stylex.props(styles.cta)}><Icon icon="mdi:send" width={16} />{t("home.hero.submit")}</A> */}
          <p {...stylex.props(styles.ctaHint)}>{t("home.hero.ctaHint")}</p>
        </div>
        
      </section>

      <div {...stylex.props(layouts.fullRow, styles.listTitleRow)}>
        <div {...stylex.props(styles.listTitle)}>{t("home.recommended")}</div>
        <A href="/discover" {...stylex.props(styles.moreLink)}>{t("home.hero.browse")}</A>
      </div>
    </div>
      <div {...stylex.props(layouts.fullRow)}>
      <Show
        when={list()?.length}
        fallback={
          <Show when={list.loading} fallback={<div {...stylex.props(styles.empty)}>{t("common.empty")}</div>}>
            {/* 异步加载中：骨架屏占位（与真实卡片同尺寸，桌面 4 列 / 移动 2 列） */}
            <div {...stylex.props(styles.skeletonGrid)}>
              <For each={Array.from({ length: 4 })}>
                {() => (
                  <div {...stylex.props(styles.card, styles.skeletonCard)}>
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonCover)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonLine, styles.skeletonLineTitle)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonLine)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonBtn)} />
                  </div>
                )}
              </For>
            </div>
          </Show>
        }
      >
        {/* 滚屏轨道：每屏 4 条，transform 平移切换 */}
        <div {...stylex.props(styles.viewport)}>
          <div {...stylex.props(styles.track)} style={{ transform: `translateX(-${curPage() * 100}%)` }}>
            <For each={pageIndexes()}>
              {(i) => (
                <div {...stylex.props(styles.pagePane)}>
                  <For each={pageItems(i)}>
                    {(ep) => (
                      // hover 预取详情数据（点击进详情页即开；移动端无 hover → 走全局 spinner 过渡）
                      <div
                        {...stylex.props(styles.card)}
                        onClick={() => navigate(`/episode/${ep.slug}`)}
                        onPointerEnter={() => void getEpisodeCached(ep.slug)}
                      >
                        <Show when={episodeCoverUrl(ep.id, ep.coverUrl)} fallback={<div {...stylex.props(styles.coverFallback)}>🎙</div>}>
                          <img src={episodeCoverUrl(ep.id, ep.coverUrl)!} alt={ep.title || ""} {...stylex.props(styles.cover)} />
                        </Show>
                        <p {...stylex.props(styles.title)}>{ep.title || t("common.unnamed")}</p>
                        <p {...stylex.props(styles.meta)}>
                          {hostName(ep)} · {fmtDuration(ep.durationSeconds)}
                        </p>
                        <div {...stylex.props(styles.cardActions)}>
                          <button
                            {...stylex.props(styles.playBtn, isCurrent(ep.id) && playback.playing() && styles.playBtnActive)}
                            onClick={(e) => { e.stopPropagation(); isCurrent(ep.id) ? playback.toggle() : playback.play(ep); }}
                          >
                            {/* 正在播放 → 暂停（实底高亮）；其余（含当前曲目暂停时）→ 播放（普通样式） */}
                            {isCurrent(ep.id) && playback.playing() ? "⏸" : "▶"}{" "}
                            {isCurrent(ep.id) && playback.playing() ? t("common.pause") : t("common.play")}
                          </button>
                          {/* 正在播放：已播放时间 / 总时长（实时跟随播放器进度）——未播放时所有卡片一致 */}
                          <Show when={isCurrent(ep.id) && playback.playing()}>
                            <span {...stylex.props(styles.playingTime)}>
                              {fmt(playback.progress())} / {fmt(playback.duration())}
                            </span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                  {/* 末屏不足 4 条：灰块补齐，保持每屏等宽 */}
                  <For each={Array.from({ length: PAGE_SIZE - pageItems(i).length })}>
                    {() => <div {...stylex.props(styles.grayBlock)} />}
                  </For>
                </div>
              )}
            </For>
          </div>
        </div>
        {/* 分页控制：仅多屏时显示（‹ 上一页 · 圆点 · 下一页 ›） */}
        <Show when={pageCount() > 1}>
          <div {...stylex.props(styles.controls)}>
            <button
              {...stylex.props(styles.navBtn)}
              disabled={curPage() === 0}
              aria-label={t("home.recommended.prev")}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              ‹
            </button>
            <div {...stylex.props(styles.dots)}>
              <For each={pageIndexes()}>
                {(i) => (
                  <button
                    {...stylex.props(styles.dot, i === curPage() && styles.dotActive)}
                    aria-label={t("home.recommended.page", { page: i + 1 })}
                    onClick={() => setPage(i)}
                  />
                )}
              </For>
            </div>
            <button
              {...stylex.props(styles.navBtn)}
              disabled={curPage() >= pageCount() - 1}
              aria-label={t("home.recommended.next")}
              onClick={() => setPage((p) => Math.min(pageCount() - 1, p + 1))}
            >
              ›
            </button>
          </div>
        </Show>
      </Show>
      </div>

      {/* 站点头部统计卡片：主播 / AI 嘉宾 / 访谈期数（等宽等高灰色区块） */}
      <div {...stylex.props(layouts.fullRow)}>
      <Show when={stats()}>
        <div {...stylex.props(styles.statCards)}>
          <A href="/hosts" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statHosts", { count: stats()!.hostCount, plural: stats()!.hostCount === 1 ? "" : "s" })}</div>
            <Show when={stats()!.topHostAvatar} fallback={<div {...stylex.props(styles.statLogoFallback)}>{stats()!.topHost?.slice(0, 1) || "?"}</div>}>
              <img src={stats()!.topHostAvatar!} alt="" {...stylex.props(styles.statLogo)} />
            </Show>
            <div {...stylex.props(styles.statText)}>{stats()!.topHost || ""}</div>
          </A>
          <A href="/guests" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statGuests", { count: stats()!.guestCount, plural2: stats()!.guestCount === 1 ? "" : "s" })}</div>
            <div {...stylex.props(styles.statLogos)}>
              <For each={guestLogos() ?? []}>
                {(g) => (
                  <Show when={g.avatar} fallback={<div {...stylex.props(styles.statLogoFallbackSmall)}>{g.name.slice(0, 1)}</div>}>
                    <img src={g.avatar!} alt={g.name} {...stylex.props(styles.statLogoSmall)} />
                  </Show>
                )}
              </For>
            </div>
            <div {...stylex.props(styles.statText)}>{t("home.statGuestsSub")}</div>
          </A>
          <A href="/discover" {...stylex.props(styles.statCard)}>
            <div {...stylex.props(styles.statTitle)}>{t("home.statEpisodes", { count: stats()!.episodeCount, plural3: stats()!.episodeCount === 1 ? "" : "s" })}</div>
            <div {...stylex.props(styles.statTags)}>
              <For each={stats()!.topTags}>
                {(tag) => <span {...stylex.props(styles.statTag)}>{tag}</span>}
              </For>
            </div>
            <div {...stylex.props(styles.statText)}>{t("home.statEpisodesSub")}</div>
          </A>
        </div>
      </Show>
      </div>

      {/* 常见问题（互斥手风琴，双语跟随语言切换） */}
      <div {...stylex.props(layouts.fullRow)}>
      <Faq />
      </div>
      </div>
  );
}
