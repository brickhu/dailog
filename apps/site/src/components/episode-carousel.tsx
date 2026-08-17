// 节目卡片滚屏容器（推荐/列表共用）：
// - 不包含标题行（调用方自行渲染）；必须放在 containerLg 网格内
// - subgrid 继承 containerLg 轨道：根 1/-1 → 卡片 span 3(≥1025)/span 2（8 列 4 张一行、4 列 2×2）
// - 屏们重叠在同一行（grid-row: 1），切换 = 每屏自身 translateX((i-cur)*100%) 平移
// - 数据由调用方传入（null = 加载中显示骨架屏）；分页/播放/预取/灰块补齐内置
import { createEffect, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { getEpisodeCached } from "../lib/episode-cache";
import { EpisodeCard } from "./episode-card";

const styles = stylex.create({
  // subgrid 只能继承直接父 grid 的轨道 → 链路每层都必须是 grid + subgrid：
  // 根(1/-1) → viewport(1/-1) → 屏(1/-1, grid-row:1 重叠) → 卡片(span 3/2/2)。
  // （subgrid 与横向 auto-flow 互斥——auto-flow 会把子项塞进单列轨道）
  root: {
    gridColumn: "1 / -1", // 占满 containerLg 全部轨道（12/8/4 列均生效）
    display: "grid",
    gridTemplateColumns: "subgrid",
  },
  viewport: {
    gridColumn: "1 / -1",
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
    "@media (width >= 1024px)": {
      gridColumn: "span 3",
    },
  },
  grayBlock: {
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface, // 与卡片同底色的灰块占位
    // 固定高度：2×2 时第二行可能全是灰块（没有卡片撑起行高，空 div 高度 0 会塌陷）；
    // 高度按对应断点卡片高度取整（封面 aspect 1:1 + 标题/meta/按钮 ≈ +100px）
    minHeight: "270px",
    "@media (640px <= width < 1024px)": {
      minHeight: "310px",
    },
    "@media (width >= 1024px)": {
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
});

const PAGE_SIZE = 4;
const MAX_PAGES = 5;

export function EpisodeCarousel(props: {
  /** 节目列表；null = 加载中（骨架屏占位）。数据更新自动回到第一屏 */
  episodes: QueueEpisode[] | null;
  /** 是否加载中（episodes 为 null 且 loading 时显示骨架屏；加载完仍空显示 empty） */
  loading: boolean;
}) {
  const { t } = useI18n();
  const playback = usePlayback();
  const navigate = useNavigate();
  const [page, setPage] = createSignal(0); // 当前屏

  // 数据刷新（引用变化）→ 回到第一屏（clamp 保护）
  createEffect(() => {
    props.episodes;
    setPage(0);
  });

  // 当前播放中的节目（卡片三态按钮与播放条高亮用）
  const isCurrent = (id: string) => playback.current()?.id === id;
  // 分页：每屏 4 条、最多 5 屏；末屏不足 4 条由灰块补齐
  const pageCount = () =>
    props.episodes?.length ? Math.min(MAX_PAGES, Math.ceil(props.episodes.length / PAGE_SIZE)) : 0;
  const pageIndexes = () => Array.from({ length: pageCount() }, (_, i) => i);
  const pageItems = (i: number) => props.episodes!.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
  const curPage = () => Math.max(0, Math.min(page(), pageCount() - 1));

  return (
    <div {...stylex.props(styles.root)}>
      <Show
        when={props.episodes?.length}
        fallback={
          <Show when={props.loading} fallback={<div {...stylex.props(styles.empty)}>{t("common.empty")}</div>}>
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
                    // grid 模式节目卡片：封面三态按钮（hover 划入）+ 标题 + 时间 + 时长；
                    // hover 预取详情数据（点击进详情页即开）
                    <div {...stylex.props(styles.cardSpan)}>
                      <EpisodeCard
                        episode={ep}
                        playing={isCurrent(ep.id) && playback.playing()}
                        onPlay={() => playback.play(ep)}
                        onPause={() => playback.toggle()}
                        onClick={() => navigate(`/episode/${ep.slug}`)}
                        onHover={() => void getEpisodeCached(ep.slug)}
                      />
                    </div>
                  )}
                </For>
                {/* 末屏不足 4 条：灰块补齐，保持每屏等宽（同卡片 span） */}
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
  );
}
