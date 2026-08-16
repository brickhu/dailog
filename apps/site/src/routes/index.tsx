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
import { openImportDialog } from "../components/import-dialog";
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
    gridColumn: "span 7", // 桌面 12 列占 7 / 平板 8 列占 7；手机 4 列必须占满（span 7 会撑隐式轨道）
    paddingTop: dimensions.spacing12,
    "@media (max-width: 640px)": {
      gridColumn: "1 / -1",
    },
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
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    // padding: `${dimensions.spacing8} ${dimensions.spacing8} ${dimensions.spacing4}`,
    "@media (max-width: 640px)": {
      // padding: `${dimensions.spacing6} ${dimensions.spacing4} ${dimensions.spacing3}`,
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
  // ---- 推荐滚屏（subgrid 继承 containerLg 轨道）----
  // subgrid 只能继承直接父 grid 的轨道 → 链路每层都必须是 grid + subgrid：
  // recommendedRow(1/-1) → viewport(1/-1) → 屏(1/-1, grid-row:1 重叠) → 卡片(span 3/2/2)。
  // 屏们重叠在同一行（grid-row: 1），切换 = 每屏自身 translateX((i-cur)*100%) 平移
  // （subgrid 与横向 auto-flow 互斥——track 的 auto-flow 会把子项塞进单列轨道）
  recommendedRow: {
    display: "grid",
    gridTemplateColumns: "subgrid",
  },
  viewport: {
    gridColumn: "1 / -1", // 占满 containerLg 全部轨道（12/8/4 列均生效）
    display: "grid",
    gridTemplateColumns: "subgrid",
    overflow: "hidden",
  },
  pagePane: {
    gridColumn: "1 / -1",
    gridRow: "1", // 所有屏重叠在同一行（多屏切换靠各自 transform 平移）
    minWidth: "100%",
    display: "grid",
    gridTemplateColumns: "subgrid", // 卡片直接继承 containerLg 轨道（columnGap 也继承）
    rowGap: dimensions.spacing4, // subgrid 只继承列轨道；行 gap 需显式（2×2 时行间距）
    transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
  },
  // 节目卡片/灰块：12 列占 3（4 张一行）、8 列占 2（4 张一行）、4 列占 2（2×2）
  cardSpan: {
    gridColumn: "span 2",
    "@media (min-width: 1025px)": {
      gridColumn: "span 3",
    },
  },
  grayBlock: {
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface, // 与卡片同底色的灰块占位
    // 固定高度：2×2 时第二行可能全是灰块（没有卡片撑起行高，空 div 高度 0 会塌陷）；
    // 高度按对应断点卡片高度取整（封面 aspect 1:1 + 标题/meta/按钮 ≈ +100px）
    minHeight: "270px",
    "@media (min-width: 641px)": {
      minHeight: "310px",
    },
    "@media (min-width: 1025px)": {
      minHeight: "370px",
    },
  },
  // ---- 分页控制：‹ 圆点 › ----
  controls: {
    padding: `${dimensions.spacing3} 0 ${dimensions.spacing12}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": {
      padding: `${dimensions.spacing3} 0 ${dimensions.spacing8}`,
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
  // ---- 骨架屏（异步加载占位）：subgrid 继承 containerLg 轨道，卡片同真实卡片 span ----
  skeletonGrid: {
    gridColumn: "1 / -1",
    display: "grid",
    gridTemplateColumns: "subgrid",
    rowGap: dimensions.spacing4,
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
    padding: `0 ${dimensions.spacing4} ${dimensions.spacing8}`,
    display: "grid",
    // 列数跟随 containerLg 断点：4 列（手机单列堆叠）/ 8 列（3 张一行）/ 12 列（3 张一行）
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    columnGap: dimensions.spacing4,
    rowGap: dimensions.spacing4,
    "@media (min-width: 641px)": {
      padding: `0 ${dimensions.spacing8} ${dimensions.spacing12}`,
      gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
    },
    "@media (min-width: 1025px)": {
      gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
    },
  },
  statCard: {
    gridColumn: "span 4", // 手机 4 列占满 → 单列堆叠
    "@media (min-width: 641px)": {
      gridColumn: "span 2", // 平板 8 列占 2 → 3 张一行
    },
    "@media (min-width: 1025px)": {
      gridColumn: "span 4", // 桌面 12 列占 4 → 3 张一行
    },
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
            onClick={openImportDialog}
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

      <div {...stylex.props(layouts.fullRow, styles.recommendedRow)}>
      <Show
        when={list()?.length}
        fallback={
          <Show when={list.loading} fallback={<div {...stylex.props(styles.empty)}>{t("common.empty")}</div>}>
            {/* 异步加载中：骨架屏占位（subgrid 继承容器轨道，卡片同真实卡片尺寸） */}
            <div {...stylex.props(styles.skeletonGrid)}>
              <For each={Array.from({ length: 4 })}>
                {() => (
                  <div {...stylex.props(styles.card, styles.skeletonCard, styles.cardSpan)}>
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
        {/* 滚屏：屏们重叠在同一行，各自 translateX 平移（当前屏居中，相邻屏从两侧滑入） */}
        <div {...stylex.props(styles.viewport)}>
          <For each={pageIndexes()}>
            {(i) => (
              <div {...stylex.props(styles.pagePane)} style={{ transform: `translateX(${(i - curPage()) * 100}%)` }}>
                  <For each={pageItems(i)}>
                    {(ep) => (
                      // hover 预取详情数据（点击进详情页即开；移动端无 hover → 走全局 spinner 过渡）
                      <div
                        {...stylex.props(styles.card, styles.cardSpan)}
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
                  {/* 末屏不足 4 条：灰块补齐，保持每屏等宽（同卡片 3 列） */}
                  <For each={Array.from({ length: PAGE_SIZE - pageItems(i).length })}>
                    {() => <div {...stylex.props(styles.grayBlock, styles.cardSpan)} />}
                  </For>
                </div>
              )}
            </For>
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
      </div>
  );
}
