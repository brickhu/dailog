import * as stylex from "@stylexjs/stylex";
import { splitProps, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions } from "../theme.stylex";

/**
 * Skeleton（复刻 Astryx Skeleton：https://astryx.atmeta.com/components/Skeleton，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 纯装饰加载占位：aria-hidden="true"，读屏不播报空内容——加载态由外层区域
 *   aria-busy 表达（WCAG complex-20）
 * - 闪烁动画：opacity 0.25↔1 交替（steps(10, end) 步进、无限循环）；
 *   prefers-reduced-motion: reduce 时停用（静态占位仍可读）
 * - 动画延迟 = 1000ms + 100ms × index：防快速加载内容闪动 + 多骨架波浪效果
 * - 对比度适配：prefers-contrast: more 时底色混入前景色 30%；
 *   forced-colors: active（Windows 高对比）时用系统色 GrayText + opacity 1——
 *   否则 painted background 被剥掉、占位不可见（WCAG 1.4.11）；
 *   规则顺序必须 default → prefers-contrast → forced-colors（两者同时命中时后者胜）
 * - 圆角档位：none=0 / 0=radius0 / 1=radiusSm / 2=radiusMd / 3=radiusLg（默认）/
 *   4=radiusXl / rounded=radiusFull（头像、胶囊）
 * - 变量使用 theme.stylex tokens；theme.stylex 暂无 skeleton 底色与
 *   duration-medium-max 档位，内联定义（如需进主题可加 colors.skeleton /
 *   durations.durationMediumMax）
 */

export type SkeletonRadius = "none" | 0 | 1 | 2 | 3 | 4 | "rounded";

export interface SkeletonProps extends JSX.HTMLAttributes<HTMLDivElement> {
  /** 宽度：数字=px，字符串原样 @default "100%" */
  width?: number | string;
  /** 高度：数字=px，字符串原样 @default "100%" */
  height?: number | string;
  /** 圆角档位 @default 3 */
  radius?: SkeletonRadius;
  /** 交错动画序号（多个骨架用 0,1,2,… 产生波浪效果）@default 0 */
  index?: number;
  /** 外部注入 StyleX 样式（最后合并，冲突时覆盖内部） */
  xstyle?: StyleXStyles;
  /** 外部 class（Solid 别名，与 class 等价；与内部 stylex 类名拼接不覆盖） */
  className?: string;
}

// theme.stylex 无 skeleton token：底色内联（浅色中灰 / 深色中灰，再叠 opacity 0.25）
const SKELETON = "#9a9a9a";
const DARK = "@media (prefers-color-scheme: dark)";
const SKELETON_DARK = "#5c5f66";

// Astryx 用 --duration-medium-max（≈300ms），项目 durations 无此档位，内联
const PULSE_DURATION = "300ms";
// 初始延迟（防快速加载闪动）+ 交错步进
const DELAY_TIME = 1000;
const STAGGER_TIME = 100;

const skeletonFade = stylex.keyframes({
  "0%": { opacity: 0.25 },
  "100%": { opacity: 1 },
});

const styles = stylex.create({
  root: {
    backgroundColor: {
      default: SKELETON,
      [DARK]: SKELETON_DARK,
      "@media (prefers-contrast: more)": {
        default: `color-mix(in srgb, ${SKELETON} 70%, ${colors.foreground})`,
        [DARK]: `color-mix(in srgb, ${SKELETON_DARK} 70%, ${colors.foreground})`,
      },
      // Forced colors（Windows 高对比）会剥掉 painted background，占位将不可见；
      // GrayText 是系统色可存活（WCAG 1.4.11）。列在 prefers-contrast 之后，
      // 两者同时命中时后者胜
      "@media (forced-colors: active)": "GrayText",
    },
    opacity: {
      default: 0.25,
      // resting 0.25 会让 GrayText 在 Canvas 上几乎不可见；全 opacity 保持静态
      // 占位可感知（fade 动画在允许动效时仍会脉动）
      "@media (forced-colors: active)": 1,
    },
  },
  animate: {
    animationDirection: "alternate",
    animationDuration: PULSE_DURATION,
    animationIterationCount: "infinite",
    // reduced-motion 停用脉动；静态占位仍表达加载态
    animationName: {
      default: skeletonFade,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationTimingFunction: "steps(10, end)",
  },
});

// 圆角档位（数字档对应 Astryx 数值刻度；r 前缀仅为 stylex.create 键名）
const radiusStyles = stylex.create({
  none: { borderRadius: 0 },
  0: { borderRadius: dimensions.radius0 },
  1: { borderRadius: dimensions.radiusSm },
  2: { borderRadius: dimensions.radiusMd },
  3: { borderRadius: dimensions.radiusLg },
  4: { borderRadius: dimensions.radiusXl },
  rounded: { borderRadius: dimensions.radiusFull },
});

const SPLIT_KEYS = ["width", "height", "radius", "index", "xstyle", "style", "class", "className"] as const;

/** 加载占位（两站共享）：复刻 Astryx Skeleton 行为；脉冲块 + 交错延迟 */
export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传（ref/data-*/aria-* 等）：泛化为 Record 后展开
  const restProps = rest as Record<string, unknown>;

  // 取值判断统一包成调用表达式（供 stylex.props 条件使用；直接引用 splitProps 的
  // local/组件内 const 触发 Unsupported expression，故条件内用 props 参数取值）
  const isRadius = (r: SkeletonRadius) => (props.radius ?? 3) === r;

  // 动态尺寸/延迟（运行时值，走内联 style）
  const mergedStyle = () => {
    const w = props.width ?? "100%";
    const h = props.height ?? "100%";
    const dynamic: JSX.CSSProperties = {
      width: typeof w === "number" ? `${w}px` : w,
      height: typeof h === "number" ? `${h}px` : h,
      "animation-delay": `${DELAY_TIME + STAGGER_TIME * (props.index ?? 0)}ms`,
    };
    // string style 不参与合并；推荐对象 style 或 xstyle
    return typeof local.style === "object" ? { ...dynamic, ...local.style } : dynamic;
  };

  // 外部 class/className 不能走 rest 透传：Solid 中后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className（内部样式类全部丢失），必须显式拼接
  const mergedClass = () => {
    const attrs = stylex.props(
      styles.root,
      styles.animate,
      isRadius("none") && radiusStyles.none,
      isRadius(0) && radiusStyles[0],
      isRadius(1) && radiusStyles[1],
      isRadius(2) && radiusStyles[2],
      isRadius(3) && radiusStyles[3],
      isRadius(4) && radiusStyles[4],
      isRadius("rounded") && radiusStyles.rounded,
      // 外部注入的 StyleX 样式放最后：与内部样式冲突时外部覆盖
      props.xstyle,
    );
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  return (
    <div {...restProps} aria-hidden="true" style={mergedStyle()} {...mergedClass()} />
  );
}

Skeleton.displayName = "Skeleton";
