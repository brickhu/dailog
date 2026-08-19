// Center（复刻 Astryx Center：https://astryx.atmeta.com/components/Center，
// 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
// - flex 居中容器：axis 决定居中方向——both|vertical 加 align-items: center，
//   both|horizontal 加 justify-content: center（both 为默认，两者都有）
// - isInline 切换 display: inline-flex：文本行内居中图标/徽章，不破坏行内流
// - 尺寸（width/height/maxWidth/minHeight）走内联（同 Grid 惯例：显式调用方设定，
//   xstyle 不必覆盖）；数字=px，字符串原样（如 '100%'）
// - padding 档位复用 dialog 的 SpacingStep（0.5/1.5 = 2px/6px，theme.stylex 无此档位），
//   逻辑属性长写（paddingInlineStart/End…）与 Astryx 参考实现一致；
//   paddingInline/paddingBlock 各自覆盖 padding 的同轴值（同 Astryx 语义）
// - 垂直居中需要显式高度：flex 容器高度不定时 align-items 无参照
//   （Astryx docs best practice："Set a height when centering vertically"）
import { splitProps, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { dimensions } from "../theme.stylex";
import { type SpacingStep } from "./dialog";

/** Center 居中方向：both=双轴（默认）、horizontal=仅水平、vertical=仅垂直 */
export type CenterAxis = "both" | "horizontal" | "vertical";

export interface CenterProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref" | "style"> {
  /** 居中方向：both（双轴，默认）/ horizontal（仅水平）/ vertical（仅垂直） */
  axis?: CenterAxis;
  /** 容器宽度：数字=px，字符串原样（如 '100%'） */
  width?: number | string;
  /** 容器高度：数字=px，字符串原样（垂直居中必需——flex 容器高度不定无参照） */
  height?: number | string;
  /** 最大宽度：数字=px，字符串原样（如 '100%'） */
  maxWidth?: number | string;
  /** 最小高度：数字=px，字符串原样（如 '100%'） */
  minHeight?: number | string;
  /** 四边内边距档位（SpacingStep：1 = 4px，2 = 8px…；0.5/1.5 = 2px/6px） */
  padding?: SpacingStep;
  /** 行内（水平）内边距：同时设置时覆盖 padding 的水平轴 */
  paddingInline?: SpacingStep;
  /** 块（垂直）内边距：同时设置时覆盖 padding 的垂直轴 */
  paddingBlock?: SpacingStep;
  /** 用 inline-flex（文本行内居中图标/徽章）@default false */
  isInline?: boolean;
  /** 要居中的内容 */
  children?: JSX.Element;
  /** 根元素引用（Solid：函数回调） */
  ref?: ((el: HTMLDivElement) => void) | undefined;
  /** StyleX 样式：外部注入覆盖（stylex.create 产物，最后合并） */
  xstyle?: StyleXStyles;
  /** 内联样式（根元素） */
  style?: JSX.CSSProperties;
  /** 外部 class（Solid 别名，与 class 等价；与内部 stylex 类名拼接不覆盖） */
  className?: string;
  "data-testid"?: string;
}

const baseStyles = stylex.create({
  flex: { display: "flex" },
  inline: { display: "inline-flex" },
});

const centerStyles = stylex.create({
  alignCenter: { alignItems: "center" },
  justifyCenter: { justifyContent: "center" },
});

// padding 档位 → 项目 spacing tokens（0.5/1.5 = 2px/6px，token 无此档位，同 dialog）。
// 逻辑属性长写（paddingInlineStart/End、paddingBlockStart/End）——与 Astryx
// 参考实现的 padding.stylex.ts 一致，StyleX 校验稳定支持
const paddingInlineStyles = stylex.create({
  s0: { paddingInlineStart: dimensions.spacing0, paddingInlineEnd: dimensions.spacing0 },
  s0_5: { paddingInlineStart: "2px", paddingInlineEnd: "2px" },
  s1: { paddingInlineStart: dimensions.spacing1, paddingInlineEnd: dimensions.spacing1 },
  s1_5: { paddingInlineStart: "6px", paddingInlineEnd: "6px" },
  s2: { paddingInlineStart: dimensions.spacing2, paddingInlineEnd: dimensions.spacing2 },
  s3: { paddingInlineStart: dimensions.spacing3, paddingInlineEnd: dimensions.spacing3 },
  s4: { paddingInlineStart: dimensions.spacing4, paddingInlineEnd: dimensions.spacing4 },
  s5: { paddingInlineStart: dimensions.spacing5, paddingInlineEnd: dimensions.spacing5 },
  s6: { paddingInlineStart: dimensions.spacing6, paddingInlineEnd: dimensions.spacing6 },
  s8: { paddingInlineStart: dimensions.spacing8, paddingInlineEnd: dimensions.spacing8 },
  s10: { paddingInlineStart: dimensions.spacing10, paddingInlineEnd: dimensions.spacing10 },
});

const paddingBlockStyles = stylex.create({
  s0: { paddingBlockStart: dimensions.spacing0, paddingBlockEnd: dimensions.spacing0 },
  s0_5: { paddingBlockStart: "2px", paddingBlockEnd: "2px" },
  s1: { paddingBlockStart: dimensions.spacing1, paddingBlockEnd: dimensions.spacing1 },
  s1_5: { paddingBlockStart: "6px", paddingBlockEnd: "6px" },
  s2: { paddingBlockStart: dimensions.spacing2, paddingBlockEnd: dimensions.spacing2 },
  s3: { paddingBlockStart: dimensions.spacing3, paddingBlockEnd: dimensions.spacing3 },
  s4: { paddingBlockStart: dimensions.spacing4, paddingBlockEnd: dimensions.spacing4 },
  s5: { paddingBlockStart: dimensions.spacing5, paddingBlockEnd: dimensions.spacing5 },
  s6: { paddingBlockStart: dimensions.spacing6, paddingBlockEnd: dimensions.spacing6 },
  s8: { paddingBlockStart: dimensions.spacing8, paddingBlockEnd: dimensions.spacing8 },
  s10: { paddingBlockStart: dimensions.spacing10, paddingBlockEnd: dimensions.spacing10 },
});

const SPLIT_KEYS = [
  "axis",
  "width",
  "height",
  "maxWidth",
  "minHeight",
  "padding",
  "paddingInline",
  "paddingBlock",
  "isInline",
  "children",
  "xstyle",
  "style",
  "class",
  "className",
  "ref",
] as const;

/**
 * Center 居中容器（两站共享）：flex 布局把内容居中到指定方向。语义上只是布局 div，
 * 无需额外 ARIA；原生属性（id / data-* / aria-* / on* 等）透传根元素。
 */
export function Center(props: CenterProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  const restProps = rest as Record<string, unknown>;

  // 轴解析：both|vertical → align-items center；both|horizontal → justify-content center
  const isAxis = (a: CenterAxis) => (props.axis ?? "both") === a;

  // padding 解析（同 Astryx）：paddingInline / paddingBlock 各自覆盖 padding 的同轴值
  const resolvedInline = () => props.paddingInline ?? props.padding;
  const resolvedBlock = () => props.paddingBlock ?? props.padding;
  const isPadInline = (s: SpacingStep) => (resolvedInline() ?? -1) === s;
  const isPadBlock = (s: SpacingStep) => (resolvedBlock() ?? -1) === s;

  // 尺寸（width/height/maxWidth/minHeight）走内联：显式调用方设定，xstyle 不必覆盖
  const sizeStyle = (): JSX.CSSProperties => {
    const inline: JSX.CSSProperties = {};
    const set = (
      key: "width" | "height" | "maxWidth" | "minHeight",
      value: number | string | undefined,
    ) => {
      if (value != null) {
        inline[key === "maxWidth" ? "max-width" : key === "minHeight" ? "min-height" : key] =
          typeof value === "number" ? `${value}px` : value;
      }
    };
    set("width", props.width);
    set("height", props.height);
    set("maxWidth", props.maxWidth);
    set("minHeight", props.minHeight);
    // string style 不参与合并；推荐对象 style 或 xstyle
    return typeof local.style === "object" ? { ...inline, ...local.style } : inline;
  };

  // stylex.props 条件需静态 key：档位用 sentinel 比较（同 grid/dialog 模式）
  const centerAttrs = () =>
    stylex.props(
      props.isInline ? baseStyles.inline : baseStyles.flex,
      // 单调用条件（isAxis(...) && style）——勿用 (A || B) && style：stylex 插件会对
      // || 嵌套条件做常量求值并内联本地函数，遇到 props 标识符直接抛
      // "Unsupported expression: Identifier"（单调用条件会短路跳过求值）
      isAxis("both") && centerStyles.alignCenter,
      isAxis("vertical") && centerStyles.alignCenter,
      isAxis("both") && centerStyles.justifyCenter,
      isAxis("horizontal") && centerStyles.justifyCenter,
      // paddingInline（11 档）
      isPadInline(0) && paddingInlineStyles.s0,
      isPadInline(0.5) && paddingInlineStyles.s0_5,
      isPadInline(1) && paddingInlineStyles.s1,
      isPadInline(1.5) && paddingInlineStyles.s1_5,
      isPadInline(2) && paddingInlineStyles.s2,
      isPadInline(3) && paddingInlineStyles.s3,
      isPadInline(4) && paddingInlineStyles.s4,
      isPadInline(5) && paddingInlineStyles.s5,
      isPadInline(6) && paddingInlineStyles.s6,
      isPadInline(8) && paddingInlineStyles.s8,
      isPadInline(10) && paddingInlineStyles.s10,
      // paddingBlock（11 档）
      isPadBlock(0) && paddingBlockStyles.s0,
      isPadBlock(0.5) && paddingBlockStyles.s0_5,
      isPadBlock(1) && paddingBlockStyles.s1,
      isPadBlock(1.5) && paddingBlockStyles.s1_5,
      isPadBlock(2) && paddingBlockStyles.s2,
      isPadBlock(3) && paddingBlockStyles.s3,
      isPadBlock(4) && paddingBlockStyles.s4,
      isPadBlock(5) && paddingBlockStyles.s5,
      isPadBlock(6) && paddingBlockStyles.s6,
      isPadBlock(8) && paddingBlockStyles.s8,
      isPadBlock(10) && paddingBlockStyles.s10,
      // 外部注入的 StyleX 样式放最后：与内部样式冲突时外部覆盖
      props.xstyle,
    );

  // 外部 class/className 不能走 rest 透传：Solid 中后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className（内部样式类全部丢失），必须显式拼接；
  // style 合并：stylex 动态样式产生的 CSS 变量与尺寸内联合并后再一次性展开
  const mergedAttrs = () => {
    const attrs = centerAttrs();
    const mergedStyle: JSX.CSSProperties = {
      ...(attrs.style ?? {}),
      ...sizeStyle(),
    };
    const base = { ...attrs, style: mergedStyle };
    const external = local.class ?? local.className;
    if (external == null) return base;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...base, className };
  };

  return (
    <div
      ref={local.ref}
      {...restProps}
      {...mergedAttrs()}
    >
      {props.children}
    </div>
  );
}

Center.displayName = "Center";
