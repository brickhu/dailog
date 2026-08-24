import * as stylex from "@stylexjs/stylex";
import { splitProps, type JSX } from "solid-js";
import { A } from "@solidjs/router";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations } from "@dailogues/ui/theme.stylex";
import {
  cardStyles,
  cardPaddings,
  cardElevations,
  type CardPadding,
  type CardElevation,
  type SizeValue,
} from "./card";
import { useClickableContainer } from "./use-clickable-container";

// 类型兼容别名：ClickableCard 继承 Card 的 padding/elevation 类型（旧 API 命名保留，消费方零改动）
export type ClickableCardPadding = CardPadding;
export type ClickableCardElevation = CardElevation;
export type { SizeValue };

/**
 * ClickableCard（复刻 Astryx ClickableCard：https://astryx.atmeta.com/components/ClickableCard，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - **样式继承自 Card**：容器（圆角/display/border-box）+ padding 档位 + elevation 复用
 *   card.tsx 导出的 cardStyles.base / cardPaddings / cardElevations；**variant（背景色 +
 *   hover 高亮）为本组件自有**（Card 无 variant，surface 底固定为 Card 的基础样式）；
 *   两者共用 CSS 变量钩子 --card-*（--card-bg / --card-border / --card-bg-hover /
 *   --card-border-hover）
 * - 整卡是激活目标（hover/focus/active 态）：href → 渲染 @solidjs/router 的 <A>
 *   （左键点击由 router 全局拦截做 SPA 导航；水合前退化为原生 <a> 跳转；
 *   Enter/中键/Cmd+点击原生处理；消费方 onClick 直透锚点，preventDefault 可接管），
 *   仅 onClick → button 语义（Enter/Space）；label 必填作可访问名
 * - 嵌套 button/link 等自由放置、自行处理事件（点击命中嵌套交互元素时卡片不激活）；
 *   注意：href 卡片渲染为 <a>，其内再嵌 <a>/<button> 属无效 HTML，嵌套交互请用非 href 卡片
 * - isDisabled → aria-disabled + tabIndex=-1 + 不响应 + opacity 0.5
 * - variant 为背景色变体：default 带边框（hover 加深），transparent/muted 及彩色变体无边框；
 *   12 色映射项目语义色板（secondary/success/warning/danger/…），可经 CSS 变量或 xstyle 覆盖
 * - elevation 悬浮阴影（none/low/med/high → shadows 档位），常暗示整卡可点
 * - padding 档位 = spacing 步进 ×4px（0.5/1.5 半档用 calc 绑定 spacing1）
 * - 主题化钩子：固定类 .dailog-clickable-card + data-variant/data-elevation + CSS 变量
 *   （--card-bg / --card-border / --card-bg-hover / --card-border-hover，与 Card 共用）
 */

// 半透明墨色边框（同 Button GROUP_DIVIDER 套路：直接模板字符串，StyleX 编译期静态求值）
const BORDER_DEFAULT = colors.surface;
const BORDER_HOVER = colors.surfaceStrong;

// —— 交互层样式（Card 只负责视觉，点击/导航相关的都在本层）——
const clickableStyles = stylex.create({
  interactive: {
    cursor: "pointer",
    // href 卡片渲染为真实 <a>：去浏览器默认下划线、颜色随上下文
    textDecoration: "none",
    color: "inherit",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: {
      default: durations.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  disabled: {
    cursor: "not-allowed",
    opacity: 0.5,
  },
  // 项目惯例 focus-visible 2px 描边 + 3px offset（同 Button focusStyles）
  focus: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.primary}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
});

// variant 背景色映射到项目语义色板；hover 走对应 *Strong（同 Button fill 惯例），
// 均绑 CSS 变量钩子供外部覆盖（--card-bg / --card-bg-hover / --card-border / --card-border-hover）；
// :hover 带 :not([aria-disabled]) 抑制禁用态高亮
export type ClickableCardVariant =
  | "default"
  | "transparent"
  | "muted"
  | "blue"
  | "cyan"
  | "gray"
  | "green"
  | "orange"
  | "pink"
  | "purple"
  | "red"
  | "teal"
  | "yellow";

const variants = stylex.create({
  default: {
    backgroundColor: `var(--card-bg, ${colors.surface})`,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: `var(--card-border, ${BORDER_DEFAULT})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": {
        backgroundColor: `var(--card-bg-hover, ${colors.surfaceWeak})`,
        borderColor: `var(--card-border-hover, ${BORDER_HOVER})`,
      },
    },
  },
  transparent: {
    backgroundColor: `var(--card-bg, transparent)`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": {
        backgroundColor: `var(--card-bg-hover, ${colors.surfaceWeak})`,
      },
    },
  },
  muted: {
    backgroundColor: `var(--card-bg, ${colors.surfaceWeak})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": {
        backgroundColor: `var(--card-bg-hover, ${colors.surfaceStrong})`,
      },
    },
  },
  blue: {
    backgroundColor: `var(--card-bg, ${colors.secondary})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.secondaryStrong})` },
    },
  },
  cyan: {
    backgroundColor: `var(--card-bg, ${colors.secondaryWeak})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.secondaryStrong})` },
    },
  },
  gray: {
    backgroundColor: `var(--card-bg, ${colors.neutral})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.neutralStrong})` },
    },
  },
  green: {
    backgroundColor: `var(--card-bg, ${colors.success})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.successStrong})` },
    },
  },
  orange: {
    backgroundColor: `var(--card-bg, ${colors.warning})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.warningStrong})` },
    },
  },
  pink: {
    backgroundColor: `var(--card-bg, ${colors.danger})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.dangerStrong})` },
    },
  },
  purple: {
    backgroundColor: `var(--card-bg, ${colors.primary})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.primaryStrong})` },
    },
  },
  red: {
    backgroundColor: `var(--card-bg, ${colors.danger})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.dangerStrong})` },
    },
  },
  teal: {
    backgroundColor: `var(--card-bg, ${colors.successWeak})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.successStrong})` },
    },
  },
  yellow: {
    backgroundColor: `var(--card-bg, ${colors.warningWeak})`,
    ":hover:not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: `var(--card-bg-hover, ${colors.warningStrong})` },
    },
  },
});

export interface ClickableCardProps
  extends Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    | "label" | "onClick" | "children" | "style"
    | "class" | "className" | "role" | "tabIndex"
    | "aria-label" | "aria-disabled" | "onKeyDown"
  > {
  /** 可访问名（Astryx 语义，必填） */
  label: string;
  /** 点击处理：仅在卡面触发（嵌套交互元素命中时跳过） */
  onClick?: (e: MouseEvent) => void;
  /** 导航 URL：提供时卡片为 link 语义 */
  href?: string;
  /** 链接目标 @default "_self" */
  target?: string;
  /** 禁用：aria-disabled + 不可聚焦 + 不响应 @default false */
  isDisabled?: boolean;
  /** 卡片内容（可自由嵌套 button/link 等交互元素） */
  children?: JSX.Element;
  /** 内边距档位（= spacing 步进 ×4px）@default 4 */
  padding?: ClickableCardPadding;
  /** 背景色变体（映射项目语义色板）@default "default" */
  variant?: ClickableCardVariant;
  /** 悬浮阴影层级 @default "none" */
  elevation?: ClickableCardElevation;
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
  "label", "onClick", "href", "target", "isDisabled", "children",
  "padding", "variant", "elevation", "width", "height", "maxWidth",
  "xstyle", "style", "class", "className",
] as const;

/** 可点击卡片：整卡导航/单一操作目标（= Card 视觉基底 + variant/交互层），嵌套交互元素独立工作 */
export function ClickableCard(props: ClickableCardProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);

  const cc = useClickableContainer({
    getHref: () => local.href,
    getTarget: () => local.target ?? "_self",
    getOnClick: () => local.onClick,
    getDisabled: () => !!local.isDisabled,
    getLabel: () => local.label,
  });

  // stylex.props 条件必须是调用表达式或直接引用 props 参数（项目 StyleX 编译约束）
  const isVariant = (v: ClickableCardVariant) => (props.variant ?? "default") === v;
  const isElevation = (e: ClickableCardElevation) => (props.elevation ?? "none") === e;
  const isPadding = (p: ClickableCardPadding) => (props.padding ?? 4) === p;

  // 继承 Card 的视觉层（cardStyles.base / cardPaddings / cardElevations）+ 本组件的
  // variant（背景色 + hover）+ 交互层（interactive/focus/disabled）；外部 xstyle 放最后：
  // 冲突时外部覆盖
  const mergedAttrs = () => {
    const attrs = stylex.props(
      cardStyles.base,
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
      isVariant("default") && variants.default,
      isVariant("transparent") && variants.transparent,
      isVariant("muted") && variants.muted,
      isVariant("blue") && variants.blue,
      isVariant("cyan") && variants.cyan,
      isVariant("gray") && variants.gray,
      isVariant("green") && variants.green,
      isVariant("orange") && variants.orange,
      isVariant("pink") && variants.pink,
      isVariant("purple") && variants.purple,
      isVariant("red") && variants.red,
      isVariant("teal") && variants.teal,
      isVariant("yellow") && variants.yellow,
      isElevation("low") && cardElevations.low,
      isElevation("med") && cardElevations.med,
      isElevation("high") && cardElevations.high,
      clickableStyles.interactive,
      clickableStyles.focus,
      cc.role() == null && clickableStyles.disabled,
      // 外部注入的 StyleX 样式放最后：冲突时外部覆盖
      props.xstyle,
    );
    // 外部 class 不能走 rest 透传（后 spread 会整体覆盖内部 stylex 类），显式拼接
    const external = [local.class, local.className].filter(Boolean).join(" ");
    const themed = "dailog-clickable-card" + (external ? ` ${external}` : "");
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

  // href 卡片渲染为 @solidjs/router 的 <A>：左键点击由 router 的全局锚点拦截做 SPA 导航
  // （水合前退化为原生 <a> 跳转；中键/Cmd+点击/Enter 原生处理）；消费方 onClick 直透锚点
  // （preventDefault 可接管导航）。禁用或非 href 卡片保持 div + useClickableContainer
  // （button 语义 + 嵌套交互元素跳过 + 禁用拦截）。
  // 嵌套交互元素仅建议用于非 href 卡片——<a> 内再嵌 <a>/<button> 属无效 HTML。
  const isLink = () => local.href != null && !local.isDisabled;

  return isLink() ? (
    <A
      href={local.href}
      // target 仅在显式非 "_self" 时下发给锚点：router 的锚点拦截会因任何
      // target 属性（含 _self）而跳过 SPA，_self 是默认值不应写进 DOM
      target={local.target != null && local.target !== "_self" ? local.target : undefined}
      onClick={local.onClick}
      aria-label={cc.ariaLabel()}
      aria-disabled={cc.ariaDisabled()}
      data-variant={props.variant ?? "default"}
      data-elevation={props.elevation ?? "none"}
      style={mergedStyle()}
      {...mergedAttrs()}
      {...rest}
    >
      {local.children}
    </A>
  ) : (
    <div
      ref={cc.setRef}
      role={cc.role()}
      tabIndex={cc.tabIndex()}
      aria-label={cc.ariaLabel()}
      aria-disabled={cc.ariaDisabled()}
      data-variant={props.variant ?? "default"}
      data-elevation={props.elevation ?? "none"}
      onClick={cc.handleClick}
      onKeyDown={cc.handleKeyDown}
      style={mergedStyle()}
      {...mergedAttrs()}
      {...rest}
    >
      {local.children}
    </div>
  );
}
