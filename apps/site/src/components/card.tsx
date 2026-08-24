import * as stylex from "@stylexjs/stylex";
import { splitProps, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, shadows } from "@dailogues/ui/theme.stylex";

/**
 * Card（基础卡片容器，site-local）
 * - 参照 ClickableCard 抽取的视觉基底：**纯视觉容器**（surface 底 + 1px 边框 + 圆角 +
 *   padding 档位 + elevation 阴影），无 variant 背景色变体、无任何交互语义
 *   （无 cursor/hover/focus/disabled——那是 ClickableCard 的交互层职责）
 * - 与 ClickableCard 的样式继承：本文件导出的 cardStyles / cardPaddings / cardElevations
 *   是两者共享的视觉层，ClickableCard 继承 cardStyles.base（容器）+ cardPaddings +
 *   cardElevations，其上叠加自己的 variant（背景色 + hover）与交互层；CSS 变量钩子共用
 *   --card-*（--card-bg / --card-border，hover 变量 --card-bg-hover / --card-border-hover
 *   归 ClickableCard 交互层）
 * - elevation 悬浮阴影（none/low/med/high → shadows 档位）
 * - padding 档位 = spacing 步进 ×4px（0.5/1.5 半档用 calc 绑定 spacing1）
 * - 主题化钩子：固定类 .dailog-card + data-elevation + CSS 变量
 *   （--card-bg / --card-border，可经 CSS 变量或 xstyle 覆盖）
 */

export type SizeValue = number | string;
export type CardPadding = 0 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6 | 8 | 10;
export type CardElevation = "none" | "low" | "med" | "high";

// 半透明墨色边框（同 Button GROUP_DIVIDER 套路：直接模板字符串，StyleX 编译期静态求值）
const BORDER_DEFAULT = colors.surface;

// —— 共享视觉样式层（ClickableCard 继承 cardStyles.base / cardPaddings / cardElevations）——
export const cardStyles = stylex.create({
  // 纯容器（不携带表面色/边框——表面归 Card 的 surface、背景色归 ClickableCard 的 variant）
  base: {
    position: "relative",
    boxSizing: "border-box",
    display: "block",
    borderRadius: dimensions.radiusLg,
  },
  // Card 默认表面：surface 底 + 1px 半透明墨色边框（原 default 变体视觉固化）；
  // 仅 Card 使用，ClickableCard 的 variant 自行控制背景/边框
  surface: {
    backgroundColor: `var(--card-bg, ${colors.surface})`,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: `var(--card-border, ${BORDER_DEFAULT})`,
  },
});

// padding 档位：0→0，其余 = spacing 步进 × 档位（0.5→2px … 10→40px）
export const cardPaddings = stylex.create({
  p0: { padding: "0" },
  p05: { padding: `calc(${dimensions.spacing1} * 0.5)` },
  p1: { padding: dimensions.spacing1 },
  p15: { padding: `calc(${dimensions.spacing1} * 1.5)` },
  p2: { padding: dimensions.spacing2 },
  p3: { padding: dimensions.spacing3 },
  p4: { padding: dimensions.spacing4 },
  p5: { padding: dimensions.spacing5 },
  p6: { padding: dimensions.spacing6 },
  p8: { padding: dimensions.spacing8 },
  p10: { padding: dimensions.spacing10 },
});

// 悬浮阴影档位（同 Button elevationStyles）
export const cardElevations = stylex.create({
  none: { boxShadow: "none" },
  low: { boxShadow: shadows.shadowLow },
  med: { boxShadow: shadows.shadowMed },
  high: { boxShadow: shadows.shadowHigh },
});

export interface CardProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "style" | "class" | "className"> {
  /** 卡片内容（可自由嵌套任意元素） */
  children?: JSX.Element;
  /** 内边距档位（= spacing 步进 ×4px）@default 4 */
  padding?: CardPadding;
  /** 悬浮阴影层级 @default "none" */
  elevation?: CardElevation;
  /** 卡片宽度：数字=px，字符串原样 */
  width?: SizeValue;
  /** 卡片高度 */
  height?: SizeValue;
  /** 最大宽度 */
  maxWidth?: SizeValue;
  /** StyleX 外部样式覆盖（stylex.create 产物，最后合并、冲突时覆盖内部） */
  xstyle?: StyleXStyles;
  /** 透传样式（间距等页面级微调） */
  style?: JSX.CSSProperties;
  /** 外部 class（与内部样式类拼接） */
  class?: string;
  /** 外部 class（Solid 别名） */
  className?: string;
}

const SPLIT_KEYS = [
  "children", "padding", "elevation",
  "width", "height", "maxWidth", "xstyle", "style", "class", "className",
] as const;

/** 基础卡片容器：surface 底 + 圆角 + padding/elevation；无交互语义（交互/背景色变体用 ClickableCard） */
export function Card(props: CardProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);

  // stylex.props 条件必须是调用表达式或直接引用 props 参数（项目 StyleX 编译约束）
  const isElevation = (e: CardElevation) => (props.elevation ?? "none") === e;
  const isPadding = (p: CardPadding) => (props.padding ?? 4) === p;

  const mergedAttrs = () => {
    const attrs = stylex.props(
      cardStyles.base,
      cardStyles.surface,
      isPadding(0) && cardPaddings.p0,
      isPadding(0.5) && cardPaddings.p05,
      isPadding(1) && cardPaddings.p1,
      isPadding(1.5) && cardPaddings.p15,
      isPadding(2) && cardPaddings.p2,
      isPadding(3) && cardPaddings.p3,
      isPadding(4) && cardPaddings.p4,
      isPadding(5) && cardPaddings.p5,
      isPadding(6) && cardPaddings.p6,
      isPadding(8) && cardPaddings.p8,
      isPadding(10) && cardPaddings.p10,
      isElevation("low") && cardElevations.low,
      isElevation("med") && cardElevations.med,
      isElevation("high") && cardElevations.high,
      // 外部注入的 StyleX 样式放最后：冲突时外部覆盖
      props.xstyle,
    );
    // 外部 class 不能走 rest 透传（后 spread 会整体覆盖内部 stylex 类），显式拼接
    const external = [local.class, local.className].filter(Boolean).join(" ");
    const themed = "dailog-card" + (external ? ` ${external}` : "");
    const className = attrs.className ? `${attrs.className} ${themed}` : themed;
    return { ...attrs, className };
  };

  const mergedStyle = () => {
    const s: JSX.CSSProperties = { ...(local.style ?? {}) };
    if (local.width != null) s.width = typeof local.width === "number" ? `${local.width}px` : local.width;
    if (local.height != null) s.height = typeof local.height === "number" ? `${local.height}px` : local.height;
    if (local.maxWidth != null) s.maxWidth = typeof local.maxWidth === "number" ? `${local.maxWidth}px` : local.maxWidth;
    return s;
  };

  return (
    <div
      data-elevation={props.elevation ?? "none"}
      style={mergedStyle()}
      {...mergedAttrs()}
      {...rest}
    >
      {local.children}
    </div>
  );
}
