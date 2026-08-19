// 节目卡片轮播（推荐区专用）：基于共享 Carousel 组件（原生横向滚动容器）。
// - 不包含标题行（调用方自行渲染）；必须放在 containerLg 网格内（root 跨满全部轨道）
// - 数据由调用方传入（null = 加载中显示骨架屏）；分页/播放/预取内置
// - 连续滚动（无分页/圆点/灰块）：卡片等宽一排横向滚动，溢出时两侧浮现
//   Carousel 翻页按钮 + 边缘渐变遮罩；触摸拖动 / 触控板横扫 / Shift+滚轮原生支持
// - 卡片宽度：itemXstyle 用百分比（相对滚动容器实际宽度解析，精确贴边不受滚动条/
//   box-sizing 影响）——移动 <640 每屏 2 张、平板/桌面 ≥640 每屏 4 张，扣除 gap={3} 的 12px 间距
import { For, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Carousel } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import type { QueueEpisode } from "../lib/playback";
import { EpisodeCard } from "./episode-card";


// 断点标签（值同 theme.stylex.const.ts——stylex babel 插件不支持跨文件常量解析，
// 本地定义保持一致；改断点请同步 theme.stylex.const.ts）
const DESKTOP = "@media (width >= 1024px)";
const TABLET = "@media (640px <= width < 1024px)";

const styles = stylex.create({
  // containerLg 网格内跨满全部轨道（12/8/4 列均生效）
  root: {
    gridColumn: "1 / -1",
  },
  // 每张卡片宽度：百分比相对「实际」容器宽解析（精确贴边，不受滚动条宽度 /
  // box-sizing / max-width 影响）——N 张/屏 = calc(100%/N - (N-1)×gap/N)：
  // - 移动 <640：2 张/屏（1 个 12px 间距 → -6px）
  // - 平板 640-1023 / 桌面 ≥1024：4 张/屏（3 个 12px 间距 → -9px）
  item: {
    width: "calc(50% - 6px)",
    [TABLET]: {
      width: "calc(25% - 9px)",
    },
    [DESKTOP]: {
      width: "calc(25% - 9px)",
    },
  },
  // ---- 骨架屏（异步加载占位）：与真实卡片同宽的一行 ----
  skeletonRow: {
    gridColumn: "1 / -1", // containerLg 网格内跨满全部轨道
    display: "flex",
    gap: dimensions.spacing3, // 与 Carousel gap={3} 一致
  },
  skeletonCard: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    width: "100%", // 撑满 styles.item 定宽容器（flex item 默认收缩到内容宽）
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    padding: dimensions.spacing3,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceStrong,
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
  empty: {
    gridColumn: "1 / -1", // containerLg 网格内跨满全部轨道
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

/**
 * 首页推荐区节目轮播：共享 Carousel 的连续横向滚动（无分页圆点），
 * 数据更新保持当前滚动位置（原生容器行为）。
 */
export function EpisodeCarousel(props: {
  /** 节目列表；null = 加载中（骨架屏占位） */
  episodes: QueueEpisode[] | null;
  /** 是否加载中（episodes 为 null 且 loading 时显示骨架屏；加载完仍空显示 empty） */
  loading: boolean;
}) {
  const { t } = useI18n();
  // 播放/进详情/预取行为已内置到 EpisodeCard（内部接入全局播放器/router/缓存），
  // 这里只传数据
  return (
    <Show
      when={props.episodes?.length}
      fallback={
        <Show when={props.loading} fallback={<div {...stylex.props(styles.empty)}>{t("common.empty")}</div>}>
          {/* 异步加载中：与真实卡片同宽的一行骨架（透明度脉冲，颜色跟随 surface token 自动适配暗色模式） */}
          <div {...stylex.props(styles.skeletonRow)} aria-busy="true">
            <For each={Array.from({ length: 4 })}>
              {() => (
                <div {...stylex.props(styles.item)}>
                  <div {...stylex.props(styles.skeletonCard)}>
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonCover)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonLine, styles.skeletonLineTitle)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonLine)} />
                    <div {...stylex.props(styles.skeletonBlock, styles.skeletonBtn)} />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      }
    >
      {/* 连续滚动轮播：卡片等宽一排，溢出时两侧翻页按钮 + 边缘渐变遮罩（Carousel 内置）；
          卡片点击（进详情）不受滚动影响（原生滚动只在拖动时滚动） */}
      <Carousel xstyle={styles.root} itemXstyle={styles.item} gap={3} aria-label={t("home.recommended")} hasSnap hasEdgeFade={false} hasButtons={false}>
        <For each={props.episodes!}>
          {(ep) => (
            // EpisodeCard 根已 width:100% 撑满 Carousel 项包裹层，无需额外 fill 容器
            <EpisodeCard episode={ep} />
          )}
        </For>
      </Carousel>
    </Show>
  );
}
