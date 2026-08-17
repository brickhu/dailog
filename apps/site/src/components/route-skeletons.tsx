// 页面骨架屏（跟随页面自身排版结构）：
// - 供各页面数据区 <Suspense fallback> 使用（骨架分散在各自内容容器中）
// - 路由过渡期（isRouting）也复用同一套，保证切换与页面内骨架视觉一致
import { For } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";

// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (width >= 1024px)";
const TABLET = "@media (640px <= width < 1024px)";

const skeleton = stylex.create({
  // 容器（页面组件被替换期间自带背景，避免透出 body 白色）
  wrap: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: dimensions.spacing4, // 移动优先
    backgroundColor: colors.background,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    [TABLET]: {
      padding: dimensions.spacing8,
      gap: dimensions.spacing4,
    },
    [DESKTOP]: {
      padding: dimensions.spacing8,
      gap: dimensions.spacing4,
    },
  },
  // shimmer 灰块（surface 底 + 透明度脉冲）
  block: {
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
  title: {
    height: "32px",
    width: "55%",
    borderRadius: dimensions.radiusSm,
  },
  line: {
    height: "16px",
    width: "90%",
    borderRadius: dimensions.radiusSm,
  },
  lineShort: {
    width: "65%",
  },
  // 卡片网格（首页/通用）：移动优先 2 列 → 平板/桌面 4 列
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: dimensions.spacing4,
    marginTop: dimensions.spacing4,
    [TABLET]: {
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: dimensions.spacing5,
    },
    [DESKTOP]: {
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: dimensions.spacing5,
    },
  },
  card: {
    aspectRatio: "3 / 4",
    borderRadius: dimensions.radiusMd,
  },
  // 详情页：左封面 + 右详情（与 episode/[slug].tsx body 布局一致）：移动优先竖排
  detailBody: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing5,
    alignItems: "flex-start",
    [TABLET]: {
      flexDirection: "row",
      gap: dimensions.spacing8,
    },
    [DESKTOP]: {
      flexDirection: "row",
      gap: dimensions.spacing8,
    },
  },
  detailCover: {
    flexShrink: "0",
    width: "100%", // 移动优先
    maxWidth: "280px",
    margin: "0 auto",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusLg,
    [TABLET]: {
      width: "min(380px, 40vw)",
      maxWidth: "none",
      margin: 0,
    },
    [DESKTOP]: {
      width: "min(380px, 40vw)",
      maxWidth: "none",
      margin: 0,
    },
  },
  detailCol: {
    flex: "1",
    minWidth: "0",
    maxWidth: "640px",
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
  },
  // 列表页：横条（缩略方块 + 文字条，与 discover/hosts/guests 一致）
  listWrap: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing2,
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
  },
  listThumb: {
    width: "48px",
    height: "48px",
    borderRadius: dimensions.radiusSm,
    flexShrink: "0",
  },
  listText: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
});

const status = { role: "status" as const, "aria-label": "loading" };

/** 通用/首页骨架：标题 + 段落 + 卡片网格 */
export function CardGridSkeleton() {
  return (
    <div {...stylex.props(skeleton.wrap)} {...status}>
      <div {...stylex.props(skeleton.block, skeleton.title)} />
      <div {...stylex.props(skeleton.block, skeleton.line)} />
      <div {...stylex.props(skeleton.block, skeleton.line, skeleton.lineShort)} />
      <div {...stylex.props(skeleton.cards)}>
        <For each={[0, 1, 2, 3]}>
          {() => <div {...stylex.props(skeleton.block, skeleton.card)} />}
        </For>
      </div>
    </div>
  );
}

/** 详情页骨架：左封面 + 右标题/段落（跟随 /episode 排版） */
export function DetailSkeleton() {
  return (
    <div {...stylex.props(skeleton.wrap)} {...status}>
      <div {...stylex.props(skeleton.detailBody)}>
        <div {...stylex.props(skeleton.block, skeleton.detailCover)} />
        <div {...stylex.props(skeleton.detailCol)}>
          <div {...stylex.props(skeleton.block, skeleton.title)} />
          <div {...stylex.props(skeleton.block, skeleton.line, skeleton.lineShort)} />
          <div {...stylex.props(skeleton.block, skeleton.line)} />
          <div {...stylex.props(skeleton.block, skeleton.line)} />
          <div {...stylex.props(skeleton.block, skeleton.line, skeleton.lineShort)} />
        </div>
      </div>
    </div>
  );
}

/** 列表页骨架：标题 + 横条列表（跟随 discover/hosts/guests 排版） */
export function ListSkeleton() {
  return (
    <div {...stylex.props(skeleton.wrap)} {...status}>
      <div {...stylex.props(skeleton.block, skeleton.title)} />
      <div {...stylex.props(skeleton.listWrap)}>
        <For each={[0, 1, 2, 3, 4]}>
          {() => (
            <div {...stylex.props(skeleton.listRow)}>
              <div {...stylex.props(skeleton.block, skeleton.listThumb)} />
              <div {...stylex.props(skeleton.listText)}>
                <div {...stylex.props(skeleton.block, skeleton.line, skeleton.lineShort)} />
                <div {...stylex.props(skeleton.block, skeleton.line)} />
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
