import * as stylex from "@stylexjs/stylex";
import { splitProps, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions } from "../theme.stylex";

// 本地断点常量（同 skeleton.tsx / dialog.tsx 先例）：组件内媒体查询覆盖用
const DARK = "@media (prefers-color-scheme: dark)";

/**
 * Badge（复刻 Astryx Badge：https://astryx.atmeta.com/components/Badge，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 只读状态/分类指示器：根元素为 <span>，非交互（不可点击、无 focus），
 *   与参考实现一致不设 ARIA role——纯文本指示，语义由所在容器（表格/列表等）承担
 * - 结构：前置可选 icon + label，渲染顺序与参考实现一致（{icon}{label}）
 * - 基础样式全部映射 theme.stylex tokens：胶囊（radiusFull）+ 固定高 20px
 *   （spacing5，对应 Astryx --spacing-5）+ 横向 padding 8px（spacing2）+ gap 4px
 *   （spacing1）+ 12px/500（fontSizeXs + fontWeightMedium，对应 Astryx
 *   text-supporting）+ nowrap
 * - variant 语义色全部映射 theme.stylex 既有 token（实色底 + 对比文字）：
 *   neutral/info/success/warning/error → colors.neutral/secondary/success/
 *   warning/danger 系；warning 文字用 onWarningWeak（深色，琥珀底对比度达标，
 *   与 Astryx on-warning 深色文字一致；dark 模式沿用深色文字——onWarningWeak
 *   的 dark 值为浅黄 #ede3a9，对同色相琥珀底对比度不足，见 warning 样式注释）
 * - 按用户决定：Astryx 的 9 个非语义彩色变体（blue/cyan/green/orange/pink/
 *   purple/red/teal/yellow，需新增 tint 色板）不在项目 theme.stylex.ts 现有
 *   设计变量范围内，故不新增 token、variant 只保留上述 5 个语义档
 */

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";

export interface BadgeProps
  extends Omit<JSX.HTMLAttributes<HTMLSpanElement>, "style" | "class" | "className"> {
  /** 视觉样式变体（语义档：实色底 + 对比文字）@default "neutral" */
  variant?: BadgeVariant;
  /** 徽章内容（文字或数字；也可传任意 JSX） */
  label: JSX.Element;
  /** 可选前置图标（原样透传，不染色、不控制尺寸） */
  icon?: JSX.Element;
  /** 外部注入 StyleX 样式（最后合并，冲突时覆盖内部） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
  /** 透传内联样式 */
  style?: JSX.CSSProperties;
}

const styles = stylex.create({
  // 基础胶囊（Astryx Badge base 全量映射 theme.stylex tokens）
  base: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing1, // --spacing-1 = 4px
    height: dimensions.spacing5, // --spacing-5 = 20px（changelog：hardcoded height → spacing token）
    paddingBlock: 0,
    paddingInline: dimensions.spacing2, // --spacing-2 = 8px
    borderRadius: dimensions.radiusFull, // --radius-full：胶囊
    fontFamily: "inherit",
    fontSize: dimensions.fontSizeXs, // text-supporting = 12px
    lineHeight: "1.6667", // text-supporting-leading
    fontWeight: dimensions.fontWeightMedium, // 500
    whiteSpace: "nowrap",
  },
});

// 语义变体：实色底 + 对比文字（Astryx solid 语义 → 项目 colors 既有 token）
// warning 文字用 onWarningWeak 的 default 值（深色 #211e0c）：onWarning 为白色，
// 对 #e0a23c 琥珀底对比度不足；深色文字与 Astryx on-warning（#0A1317）行为一致。
// dark 模式沿用该深色值：onWarningWeak 的 dark 值为浅黄 #ede3a9，对同色相
// 琥珀底（#e0a23c 明暗一致）几乎不可见，故此处用媒体查询锁定 default 值
const variantStyles = stylex.create({
  neutral: { backgroundColor: colors.neutral, color: colors.onNeutral },
  info: { backgroundColor: colors.secondary, color: colors.onSecondary },
  success: { backgroundColor: colors.success, color: colors.onSuccess },
  warning: {
    backgroundColor: colors.warning,
    color: { default: colors.onWarningWeak, [DARK]: "#211e0c" },
  },
  error: { backgroundColor: colors.danger, color: colors.onDanger },
});

const SPLIT_KEYS = ["variant", "label", "icon", "xstyle", "style", "class", "className"] as const;

/** 只读状态/分类徽章（两站共享）：复刻 Astryx Badge 行为；variant 语义色 × 胶囊形态 */
export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);

  // StyleX 限制：stylex.props 条件必须是调用表达式或直接引用 props——
  // 取值判断统一包成函数（与 banner.tsx 同一约定）
  const isVariant = (v: BadgeVariant) => (local.variant ?? "neutral") === v;

  // 外部 class/className 显式拼接（同 button.tsx：后 spread 的 class 会整体覆盖内部 stylex 类名）
  const mergedAttrs = () => {
    const attrs = stylex.props(
      styles.base,
      isVariant("neutral") && variantStyles.neutral,
      isVariant("info") && variantStyles.info,
      isVariant("success") && variantStyles.success,
      isVariant("warning") && variantStyles.warning,
      isVariant("error") && variantStyles.error,
      local.xstyle,
    );
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  return (
    <span style={local.style} {...mergedAttrs()} {...rest}>
      {local.icon}
      {local.label}
    </span>
  );
}
