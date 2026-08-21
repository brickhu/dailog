import * as stylex from "@stylexjs/stylex";
import { children, createSignal, createUniqueId, onCleanup, onMount, splitProps, Show, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, fontfamilies, shadows } from "../theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Spinner } from "./spinner";
import { getDirective } from "../directives";
import { useButtonGroup } from "./button-group";

/**
 * Button（复刻 Astryx Button：https://astryx.atmeta.com/components/Button，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - clickAction 异步 → 自动 loading；同 tick 双击防重（isInterruptible 跳过防重且不禁用）
 * - loading 时 spinner 覆盖内容 + role="status" live region 播报；内容隐藏与 spinner 延迟
 *   ~150ms 防快速操作闪屏（显式 isLoading 立即显示），尊重 prefers-reduced-motion
 * - 有 tooltip 且禁用时用 aria-disabled 保持可聚焦；禁用时 href 回落为 <button>
 * - tooltip 为自绘（hover/focus 显示于按钮上方，role="tooltip" + aria-describedby 关联）
 * - 变量全部使用 theme.stylex 非废弃 tokens（colors/dimensions/durations/fontfamilies）
 * - 兼容层：children 可替代 label 当可见文本、disabled → isDisabled、block → width="100%"
 */

const spinnerReveal = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});
const contentHide = stylex.keyframes({
  from: { color: "inherit" },
  to: { color: "transparent" },
});
const tooltipIn = stylex.keyframes({
  from: { opacity: 0, transform: "translateX(-50%) translateY(2px)" },
  to: { opacity: 1, transform: "translateX(-50%) translateY(0)" },
});

const styles = stylex.create({
  base: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing2,
    paddingBlock: 0,
    paddingInline: dimensions.spacing3,
    // 注意：StyleX 0.19 property-specificity 模式不支持 border shorthand（静默丢弃），
    // 一律用 longhand（borderWidth/borderStyle/borderColor）
    borderStyle: "none",
    boxSizing: "border-box",
    borderRadius: dimensions.radiusMd,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transitionProperty: "background-color, color, opacity, transform",
    transitionDuration: {
      default: durations.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  pressable: {
    transform: { default: "scale(1)", ":active": "scale(0.98)" },
  },
  disabled: {
    cursor: "not-allowed",
    opacity: 0.5,
    transform: { default: "none", ":active": "none" },
  },
  iconOnly: {
    aspectRatio: "1 / 1",
    paddingInline: 0,
  },
  iconWrapper: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  contentWrapper: { display: "contents" },
  labelText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  },
  endContentWrapper: {
    display: "inline-flex",
    alignItems: "center",
    color: "inherit",
  },
  link: { textDecoration: "none" },
  // loading 时隐藏自身内容（只改色不改布局，按钮保持变体前景色）
  hiddenContent: { color: "transparent" },
  // 延迟变体：内容先保持可见，与 spinner 出现同步隐藏（防快速操作闪屏；reduced-motion 即时）
  hiddenContentDelayed: {
    animationName: contentHide,
    animationDuration: "1ms",
    animationFillMode: "forwards",
    animationDelay: {
      default: durations.durationMediumMin,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  spinnerOverlay: {
    position: "absolute",
    top: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    bottom: 0,
    display: "grid",
    placeItems: "center",
  },
  spinnerDelayed: {
    animationName: spinnerReveal,
    animationDuration: durations.durationFast,
    animationFillMode: "backwards",
    animationDelay: {
      default: durations.durationMediumMin,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  // 自绘 tooltip：hover/focus 时显示于按钮上方（随按钮滚动，定位无需 JS）
  tooltip: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: colors.popover,
    color: colors.onPopover,
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightNormal,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    animationName: tooltipIn,
    animationDuration: durations.durationFast,
    animationFillMode: "backwards",
    animationDelay: {
      default: "80ms",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
});

// 尺寸：固定高度（size token 档位）+ 随尺寸的内边距/字号
const sizeStyles = stylex.create({
  sm: { height: dimensions.sizeSm, fontSize: dimensions.fontSizeXs, paddingInline: dimensions.spacing3 },
  md: { height: dimensions.sizeMd, fontSize: dimensions.fontSizeMd, paddingInline: dimensions.spacing3 },
  lg: { height: dimensions.sizeLg, fontSize: dimensions.fontSizeMd, paddingInline: dimensions.spacing4 },
  xl: { height: dimensions.sizeXl, paddingInline: dimensions.spacing5, fontSize: dimensions.fontSizeLg },
  xxl: { height: dimensions.size2xl, paddingInline: dimensions.spacing6, fontSize: dimensions.fontSizeLg },
});

// 图标尺寸随按钮尺寸（sm~md=16 / lg~xl=20 / xxl=24）；fontSize 让 emoji/文本图标正确缩放
const iconSizeStyles = stylex.create({
  sm: { width: 16, height: 16, fontSize: 16 },
  md: { width: 16, height: 16, fontSize: 16 },
  lg: { width: 20, height: 20, fontSize: 20 },
  xl: { width: 20, height: 20, fontSize: 20 },
  xxl: { width: 24, height: 24, fontSize: 24 },
});

// 圆角档位（md 为其余尺寸默认，见 base.borderRadius；sm 为 size="sm" 组的端圆角）
const roundStyles = stylex.create({
  none: { borderRadius: dimensions.radius0 },
  sm: { borderRadius: dimensions.radiusSm },
  lg: { borderRadius: dimensions.radiusLg },
  full: { borderRadius: dimensions.radiusFull },
});

// 单按钮悬浮阴影（组内由 ButtonGroup 拥有，按钮不自持）
const elevationStyles = stylex.create({
  none: { boxShadow: "none" },
  low: { boxShadow: shadows.shadowLow },
  med: { boxShadow: shadows.shadowMed },
  high: { boxShadow: shadows.shadowHigh },
});

// 组内连接样式：圆角只在两端（首元素 start 侧 / 尾元素 end 侧），中间成员圆角 0；
// 按钮间 1px 分隔边框（horizontal 用 inline-start，vertical 用 block-start，首元素 0）。
// 尾端用 :not(:has(~ *:not([popover]))) 而非 :last-child——tooltip 成员会在按钮后渲染
// 额外 layer（popover），:last-child 会把 layer 误判为组尾成员（Astryx #2508）。
// StyleX 只静态求值同文件 const 的选择器 key。
const IS_LAST_ITEM = ":not(:has(~ *:not([popover])))";

// 分隔边框色：默认 ink 15% 半透明；实心（fill）成员经 --btn-group-divider 覆盖为
// on{variant} 20% 半透明（见各 fill 组合中的自定义属性），与实心底色协调
const GROUP_DIVIDER = `var(--btn-group-divider, color-mix(in srgb, ${colors.ink} 15%, transparent))`;

const groupStyles = stylex.create({
  horizontal: {
    borderStartStartRadius: { default: "0", ":first-child": dimensions.radiusMd },
    borderEndStartRadius: { default: "0", ":first-child": dimensions.radiusMd },
    borderStartEndRadius: { default: "0", [IS_LAST_ITEM]: dimensions.radiusMd },
    borderEndEndRadius: { default: "0", [IS_LAST_ITEM]: dimensions.radiusMd },
    borderInlineStartWidth: { default: dimensions.borderWidthThin, ":first-child": "0" },
    borderInlineStartStyle: { default: "solid", ":first-child": "none" },
    borderInlineStartColor: GROUP_DIVIDER,
  },
  // size="sm" 组：端圆角跟随尺寸默认（radiusSm），覆盖 md 档
  horizontalSm: {
    borderStartStartRadius: { ":first-child": dimensions.radiusSm },
    borderEndStartRadius: { ":first-child": dimensions.radiusSm },
    borderStartEndRadius: { [IS_LAST_ITEM]: dimensions.radiusSm },
    borderEndEndRadius: { [IS_LAST_ITEM]: dimensions.radiusSm },
  },
  vertical: {
    borderStartStartRadius: { default: "0", ":first-child": dimensions.radiusMd },
    borderStartEndRadius: { default: "0", ":first-child": dimensions.radiusMd },
    borderEndStartRadius: { default: "0", [IS_LAST_ITEM]: dimensions.radiusMd },
    borderEndEndRadius: { default: "0", [IS_LAST_ITEM]: dimensions.radiusMd },
    borderBlockStartWidth: { default: dimensions.borderWidthThin, ":first-child": "0" },
    borderBlockStartStyle: { default: "solid", ":first-child": "none" },
    borderBlockStartColor: GROUP_DIVIDER,
  },
  verticalSm: {
    borderStartStartRadius: { ":first-child": dimensions.radiusSm },
    borderStartEndRadius: { ":first-child": dimensions.radiusSm },
    borderEndStartRadius: { [IS_LAST_ITEM]: dimensions.radiusSm },
    borderEndEndRadius: { [IS_LAST_ITEM]: dimensions.radiusSm },
  },
});

// focus-visible 2px 描边跟随语义色 + 3px offset
const focusStyles = stylex.create({
  primary: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.primary}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
  secondary: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.secondary}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
  brand: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.brand}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
  neutral: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.neutral}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
  danger: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.danger}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
  warning: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.warning}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
  success: {
    outline: { default: null, ":focus-visible": `2px solid ${colors.success}` },
    outlineOffset: { default: "0", ":focus-visible": "3px" },
  },
});

// variant × appear 组合：
// - fill    实心：{variant} 底 + on{variant} 字，hover 走 *Strong（加深/提亮）
// - outline 描边：1px {variant} 边框 + {variant} 字，hover 走 *Weak 底色
// - ghost   透明：{variant} 字，hover 走 *Weak 底色
// hover 选择器带 :not(:disabled):not([aria-disabled])：禁用态（原生 disabled 或
// tooltip 场景的 aria-disabled）下滑过高亮不生效
const variants = stylex.create({
  primaryFill: {
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onPrimary} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.primaryStrong, color: colors.onPrimaryStrong },
    },
  },
  primaryOutline: {
    backgroundColor: "transparent",
    color: colors.primary,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.primary,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.primary, color: colors.onPrimaryWeak },
    },
  },
  primaryGhost: {
    backgroundColor: "transparent",
    color: colors.primary,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.primaryWeak, color: colors.onPrimaryWeak },
    },
  },
  secondaryFill: {
    backgroundColor: colors.secondary,
    color: colors.onSecondary,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onSecondary} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.secondaryStrong, color: colors.onSecondaryStrong },
    },
  },
  secondaryOutline: {
    backgroundColor: "transparent",
    color: colors.secondary,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.secondary,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.secondaryWeak, color: colors.onSecondaryWeak },
    },
  },
  secondaryGhost: {
    backgroundColor: "transparent",
    color: colors.secondary,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.secondaryWeak, color: colors.onSecondaryWeak },
    },
  },
  brandFill: {
    backgroundColor: colors.brand,
    color: colors.onBrand,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onBrand} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.brandStrong, color: colors.onBrandStrong },
    },
  },
  brandOutline: {
    backgroundColor: "transparent",
    color: colors.brand,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.brand,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.brandWeak, color: colors.onBrandWeak },
    },
  },
  brandGhost: {
    backgroundColor: "transparent",
    color: colors.brand,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.brandWeak, color: colors.onBrandWeak },
    },
  },
  neutralFill: {
    backgroundColor: colors.neutral,
    color: colors.onNeutral,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onNeutral} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.neutralStrong, color: colors.onNeutralStrong },
    },
  },
  neutralOutline: {
    backgroundColor: "transparent",
    color: colors.neutral,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.neutral,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.neutralWeak, color: colors.onNeutralWeak },
    },
  },
  neutralGhost: {
    backgroundColor: "transparent",
    color: colors.neutral,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.neutralWeak, color: colors.onNeutralWeak },
    },
  },
  dangerFill: {
    backgroundColor: colors.danger,
    color: colors.onDanger,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onDanger} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.dangerStrong, color: colors.onDangerStrong },
    },
  },
  dangerOutline: {
    backgroundColor: "transparent",
    color: colors.danger,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.danger,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.dangerWeak, color: colors.onDangerWeak },
    },
  },
  dangerGhost: {
    backgroundColor: "transparent",
    color: colors.danger,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.dangerWeak, color: colors.onDangerWeak },
    },
  },
  warningFill: {
    backgroundColor: colors.warning,
    color: colors.onWarning,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onWarning} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.warningStrong, color: colors.onWarningStrong },
    },
  },
  warningOutline: {
    backgroundColor: "transparent",
    color: colors.warning,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.warning,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.warningWeak, color: colors.onWarningWeak },
    },
  },
  warningGhost: {
    backgroundColor: "transparent",
    color: colors.warning,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.warningWeak, color: colors.onWarningWeak },
    },
  },
  successFill: {
    backgroundColor: colors.success,
    color: colors.onSuccess,
    // 组内分隔边框色（fill 成员：on 色 20% 半透明，与实心底色协调）
    "--btn-group-divider": `color-mix(in srgb, ${colors.onSuccess} 20%, transparent)`,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.successStrong, color: colors.onSuccessStrong },
    },
  },
  successOutline: {
    backgroundColor: "transparent",
    color: colors.success,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: colors.success,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.successWeak, color: colors.onSuccessWeak },
    },
  },
  successGhost: {
    backgroundColor: "transparent",
    color: colors.success,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: colors.successWeak, color: colors.onSuccessWeak },
    },
  },
});

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "brand"
  | "neutral"
  | "danger"
  | "warning"
  | "success";
export type ButtonAppear = "fill" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "xl" | "xxl";
export type ButtonRound = "md" | "sm" | "lg" | "full" | "none";
export type ButtonElevation = "none" | "low" | "med" | "high";

export interface ButtonProps
  extends Omit<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    "label" | "children" | "onClick" | "onKeyDown" | "style" | "type"
  > {
  /**
   * 可访问名（Astryx 语义）。默认渲染为可见文本；isIconOnly 时用作 aria-label。
   * 兼容层：省略时回退为 children 文本（旧 API 零改动）
   */
  label?: string;
  /**
   * 语义色变体（对应 colors 下的色板）：primary / secondary / brand / neutral /
   * danger / warning / success @default "primary"
   */
  variant?: ButtonVariant;
  /** 外观：fill 实心 / outline 描边 / ghost 透明 @default "fill" */
  appear?: ButtonAppear;
  /** 尺寸 @default "md" */
  size?: ButtonSize;
  /** 圆角：默认随尺寸——size="sm" 时为 "sm"（radiusSm），其余为 "md"（radiusMd） */
  round?: ButtonRound;
  /** 悬浮阴影层级（FAB 用；组内由 ButtonGroup 拥有）@default "none" */
  elevation?: ButtonElevation;
  /** HTML button type @default "button" */
  type?: "button" | "submit" | "reset";
  /** 禁用 @default false */
  isDisabled?: boolean;
  /** 加载态：spinner + 禁用 + live region 播报 @default false */
  isLoading?: boolean;
  /** clickAction 进行中保持可点击/可打断（不禁用、不防重）@default false */
  isInterruptible?: boolean;
  onClick?: (e: MouseEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** 异步点击动作：pending 期间自动 loading；同 tick 双击防重（isInterruptible 跳过） */
  clickAction?: (e: MouseEvent) => void | Promise<void>;
  /** 前置图标（渲染于 label 前） */
  icon?: JSX.Element;
  /** 仅图标：方形布局 + label 作 aria-label @default false */
  isIconOnly?: boolean;
  /** 宽度：数字=px，字符串原样（如 "100%"） */
  width?: number | string;
  /** 可见文本覆盖（label 仍为可访问名；省略时用 label 自身） */
  children?: JSX.Element;
  /** 尾部内容（badge/chevron），isIconOnly 时忽略 */
  endContent?: JSX.Element;
  /** 悬浮提示：hover/focus 显示于按钮上方；禁用时 aria-disabled 保持可聚焦（键盘可达） */
  tooltip?: string;
  /** 提供时渲染为 <a>（禁用时回落 <button>） */
  href?: string;
  target?: string;
  rel?: string;
  /** 透传原生样式（间距等页面级微调） */
  style?: JSX.CSSProperties;
  /** StyleX 样式：外部注入覆盖（stylex.create 产物，最后合并、冲突时覆盖内部样式） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
  // ── 兼容层（原按钮 API，替换后调用点零改动）──
  /** @deprecated 使用 isDisabled */
  disabled?: boolean;
  /** @deprecated 使用 width="100%" */
  block?: boolean;
}

const SPLIT_KEYS = [
  "label", "variant", "appear", "size", "round", "elevation", "type", "name", "value", "form",
  "isDisabled", "isLoading", "isInterruptible", "onClick", "onKeyDown",
  "clickAction", "icon", "isIconOnly", "width", "children", "endContent",
  "tooltip", "href", "target", "rel", "style", "xstyle", "disabled", "block",
  "aria-describedby", "class", "className",
] as const;

/** 基础按钮（两站共享）：复刻 Astryx Button 行为；variant 语义色 × appear 外观 × size/round 形态 */
export function Button(props: ButtonProps) {
  const { t } = useI18n();
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // icon 用 children() 包装：lazy props 里的 JSX 元素（icon={<Icon/>}）在 Solid 1.9
  // hydration 下组件 key 分配与 SSR 不一致（Hydration Mismatch）——children() 将
  // 惰性求值转为稳定 memo，SSR/客户端一致
  const iconNode = children(() => local.icon);
  const endContentNode = children(() => local.endContent);
  // ref 类型绑定 button 元素（ButtonHTMLAttributes），anchor 分支泛化后展开
  const anchorRest = rest as Record<string, unknown>;
  // ButtonGroup 感知：组内应用连接样式、整组禁用、尺寸继承；组外按钮自持 elevation/按压
  const group = useButtonGroup();
  const isInGroup = () => group != null;
  const groupOrientation = () => group?.orientation() ?? "horizontal";
  const groupDisabled = () => group?.isDisabled() === true;
  const isGroupSize = (s: ButtonSize) => group?.size() === s;
  const ownElevation = (e: ButtonElevation) => !isInGroup() && elevationOf(e);
  const pressable = () => !isInGroup();
  // 组内连接样式（圆角只在两端 + 分隔边框）；size="sm" 组覆盖为 radiusSm 端圆角
  const groupLayout = () =>
    isInGroup()
      ? groupOrientation() === "horizontal"
        ? groupStyles.horizontal
        : groupStyles.vertical
      : undefined;
  const groupLayoutSm = () =>
    isInGroup() && isGroupSize("sm")
      ? groupOrientation() === "horizontal"
        ? groupStyles.horizontalSm
        : groupStyles.verticalSm
      : undefined;

  const [pending, setPending] = createSignal(false);
  // clickAction 防重的同 tick 守卫（isInterruptible 调用方跳过）
  let actionInFlight = false;
  // 自绘 tooltip：hover/focus 显示、离开/失焦隐藏
  const tooltipId = createUniqueId();
  const [tooltipVisible, setTooltipVisible] = createSignal(false);
  const showTooltip = () => {
    if (local.tooltip != null) setTooltipVisible(true);
  };
  const hideTooltip = () => setTooltipVisible(false);
  // 与消费方传入的 aria-describedby 合并（Astryx 语义）
  const mergedDescribedBy = () =>
    local.tooltip != null
      ? [local["aria-describedby"], tooltipId].filter(Boolean).join(" ") || undefined
      : local["aria-describedby"];

  const loading = () => !!local.isLoading || pending();
  // clickAction 驱动的 loading 延迟 ~150ms 展示 spinner，快速操作不闪屏；显式 isLoading 立即
  const delaySpinner = () => pending() || !!local.isInterruptible;
  // StyleX 限制：stylex.props 条件必须是调用表达式或直接引用 props——
  // 组合条件与取值判断都包成函数（逻辑/一元表达式在编译期静态求值时炸 Unsupported expression）
  const contentHiddenDelayed = () => loading() && delaySpinner();
  const contentHiddenInstant = () => loading() && !delaySpinner();
  const isDisabled = () => !!local.isDisabled || !!local.disabled;
  const buttonDisabled = () =>
    isDisabled() || groupDisabled() || (loading() && !local.isInterruptible);
  // 有 tooltip 时用 aria-disabled 保持可聚焦（键盘用户可达 tooltip）
  const useAriaDisabled = () => local.tooltip != null && buttonDisabled();
  const renderAsLink = () => local.href != null && !buttonDisabled();

  // 取值判断统一包成调用表达式（供 stylex.props 条件使用；直接引用 props 参数，避免
  // 引用 splitProps 的 local/组件内 const 触发 Unsupported expression）
  const isSize = (s: ButtonSize) => (props.size ?? group?.size() ?? "md") === s;
  const isVariant = (v: ButtonVariant) => (props.variant ?? "primary") === v;
  const isAppear = (a: ButtonAppear) => (props.appear ?? "fill") === a;
  const elevationOf = (e: ButtonElevation) => (props.elevation ?? "none") === e;
  // round 默认随尺寸：size="sm" 时默认 sm（radiusSm，小按钮配小圆角），其余默认 md
  const isRound = (r: ButtonRound) => {
    const fallback: ButtonRound = isSize("sm") ? "sm" : "md";
    return (props.round ?? fallback) === r;
  };
  const combo = (v: ButtonVariant, a: ButtonAppear) => isVariant(v) && isAppear(a);

  const type = local.type ?? "button";

  const handleClick = (e: MouseEvent) => {
    // 防重守卫：fire-once 动作（submit/save/pay）同 tick 双击去重；isInterruptible 跳过
    if (buttonDisabled() || (actionInFlight && !local.isInterruptible)) {
      e.preventDefault();
      return;
    }
    local.onClick?.(e);
    if (local.clickAction && !e.defaultPrevented) {
      let result: void | Promise<void>;
      try {
        result = local.clickAction(e);
      } catch (err) {
        actionInFlight = false;
        setPending(false);
        throw err;
      }
      actionInFlight = true;
      setPending(true);
      Promise.resolve(result)
        .finally(() => {
          actionInFlight = false;
          setPending(false);
        })
        .catch(() => {
          // clickAction 拒绝：状态已复位；错误由消费方自己的 Promise 链处理
        });
    }
  };

  // aria-disabled 时抑制激活键（Enter/Space），其余键放行到消费者 handler
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
    } else {
      local.onKeyDown?.(e);
    }
  };

  // aria-label 场景：仅图标 / loading（非图标，播报按钮用途）/ children 覆盖 label（label 是可访问名）
  const needsAriaLabel = () =>
    local.label != null &&
    ((local.isIconOnly && local.label !== "") ||
      (loading() && !local.isIconOnly) ||
      (local.children != null && (local.children as unknown) !== local.label));

  const sharedStylexProps = () =>
    stylex.props(
      styles.base,
      sizeStyles.md,
      isSize("sm") && sizeStyles.sm,
      isSize("lg") && sizeStyles.lg,
      isSize("xl") && sizeStyles.xl,
      isSize("xxl") && sizeStyles.xxl,
      variants.primaryFill,
      combo("primary", "outline") && variants.primaryOutline,
      combo("primary", "ghost") && variants.primaryGhost,
      combo("secondary", "fill") && variants.secondaryFill,
      combo("secondary", "outline") && variants.secondaryOutline,
      combo("secondary", "ghost") && variants.secondaryGhost,
      combo("brand", "fill") && variants.brandFill,
      combo("brand", "outline") && variants.brandOutline,
      combo("brand", "ghost") && variants.brandGhost,
      combo("neutral", "fill") && variants.neutralFill,
      combo("neutral", "outline") && variants.neutralOutline,
      combo("neutral", "ghost") && variants.neutralGhost,
      combo("danger", "fill") && variants.dangerFill,
      combo("danger", "outline") && variants.dangerOutline,
      combo("danger", "ghost") && variants.dangerGhost,
      combo("warning", "fill") && variants.warningFill,
      combo("warning", "outline") && variants.warningOutline,
      combo("warning", "ghost") && variants.warningGhost,
      combo("success", "fill") && variants.successFill,
      combo("success", "outline") && variants.successOutline,
      combo("success", "ghost") && variants.successGhost,
      focusStyles.primary,
      isVariant("secondary") && focusStyles.secondary,
      isVariant("brand") && focusStyles.brand,
      isVariant("neutral") && focusStyles.neutral,
      isVariant("danger") && focusStyles.danger,
      isVariant("warning") && focusStyles.warning,
      isVariant("success") && focusStyles.success,
      isRound("sm") && roundStyles.sm,
      isRound("lg") && roundStyles.lg,
      isRound("full") && roundStyles.full,
      isRound("none") && roundStyles.none,
      groupLayout(),
      groupLayoutSm(),
      !!props.isIconOnly && styles.iconOnly,
      buttonDisabled() && styles.disabled,
      renderAsLink() && styles.link,
      pressable() && styles.pressable,
      ownElevation("low") && elevationStyles.low,
      ownElevation("med") && elevationStyles.med,
      ownElevation("high") && elevationStyles.high,
      // 外部注入的 StyleX 样式放最后：与内部样式冲突时外部覆盖
      props.xstyle,
    );

  // 外部 class/className 不能走 rest 透传：Solid 中后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className（内部样式类全部丢失），必须显式拼接
  const mergedAttrs = () => {
    const attrs = sharedStylexProps();
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  // 兼容层：block → width "100%"；动态 width（数字=px / 字符串原样）
  const mergedStyle = () => {
    const w = local.width ?? (local.block ? "100%" : undefined);
    const width = w == null ? undefined : typeof w === "number" ? `${w}px` : w;
    return width == null ? local.style : { ...local.style, width };
  };

  // 组件级 use:* 指令（如 use:auth）：Solid 的 use: 编译只作用于原生元素，
  // 组件上的 use:xxx 作为 prop 传入——通过指令注册表应用到底层根元素（button/a）
  let rootRef: HTMLElement | undefined;
  const setRootRef = (el: HTMLElement) => {
    rootRef = el;
  };
  const useDirectiveKeys = () => Object.keys(props).filter((k) => k.startsWith("use:"));
  onMount(() => {
    for (const k of useDirectiveKeys()) {
      const fn = getDirective(k.slice(4));
      const cleanup = fn?.(rootRef as HTMLElement, () => (props as Record<string, unknown>)[k]);
      if (typeof cleanup === "function") onCleanup(cleanup);
    }
  });

  const buttonContent = () => (
    <>
      {loading() && (
        <span
          {...stylex.props(styles.spinnerOverlay, delaySpinner() && styles.spinnerDelayed)}
          aria-hidden="true"
        >
          <Spinner size={16} shade="inherit" />
        </span>
      )}
      <span
        {...stylex.props(
          styles.contentWrapper,
          contentHiddenDelayed() && styles.hiddenContentDelayed,
          contentHiddenInstant() && styles.hiddenContent,
        )}
        aria-hidden={loading() || undefined}
      >
        {iconNode() && (
          <span
            {...stylex.props(
              styles.iconWrapper,
              iconSizeStyles.md,
              isSize("sm") && iconSizeStyles.sm,
              isSize("lg") && iconSizeStyles.lg,
              isSize("xl") && iconSizeStyles.xl,
              isSize("xxl") && iconSizeStyles.xxl,
            )}
          >
            {iconNode()}
          </span>
        )}
        {local.isIconOnly ? null : (
          <span {...stylex.props(styles.labelText)}>{local.children ?? local.label}</span>
        )}
        {!local.isIconOnly && endContentNode() && (
          <span {...stylex.props(styles.endContentWrapper)}>{endContentNode()}</span>
        )}
      </span>
      {/* 加载态播报 live region */}
      <span {...stylex.props(styles.visuallyHidden)} role="status" aria-live="polite">
        {loading() ? t("common.loading") : ""}
      </span>
      {/* 悬浮提示（hover/focus 触发，随按钮定位在正上方） */}
      <Show when={tooltipVisible() && local.tooltip != null}>
        <span id={tooltipId} role="tooltip" {...stylex.props(styles.tooltip)}>
          {local.tooltip}
        </span>
      </Show>
    </>
  );

  const ariaLabelProp = () => (needsAriaLabel() ? { "aria-label": local.label } : {});

  return (
    <Show
      when={renderAsLink()}
      fallback={
        <button
          ref={setRootRef}
          type={type}
          name={local.name}
          value={local.value}
          form={local.form}
          disabled={buttonDisabled() && !useAriaDisabled()}
          aria-disabled={useAriaDisabled() || undefined}
          onKeyDown={useAriaDisabled() ? handleKeyDown : local.onKeyDown}
          onClick={handleClick}
          onMouseEnter={showTooltip}
          onMouseLeave={hideTooltip}
          onFocus={showTooltip}
          onBlur={hideTooltip}
          style={mergedStyle()}
          aria-describedby={mergedDescribedBy()}
          aria-busy={loading() || undefined}
          {...mergedAttrs()}
          {...ariaLabelProp()}
          {...rest}
        >
          {buttonContent()}
        </button>
      }
    >
      <a
        ref={setRootRef}
        href={local.href}
        target={local.target}
        rel={local.rel}
        onClick={handleClick}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        style={mergedStyle()}
        aria-describedby={mergedDescribedBy()}
        aria-busy={loading() || undefined}
        {...mergedAttrs()}
        {...ariaLabelProp()}
        {...anchorRest}
      >
        {buttonContent()}
      </a>
    </Show>
  );
}
