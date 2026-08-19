// GridSpan（复刻 Astryx GridSpan：https://astryx.atmeta.com/components/GridSpan，
// 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
// - Grid 网格项控制组件：columns 跨列（数字或 'full' 跨满整行）、rows 跨行
// - 跨列/跨行走内联样式（调用方显式设定，无需 xstyle 覆盖）；基础样式走 StyleX 类
// - 列数上限 12（同 Grid）：columns 超出 12 钳制为 span 12（网格不可能超过 12 列）
//   （minWidth: 0 防溢出 + display: grid 填满单元格并拉伸子项 + height: 100%）
// - 配 Grid rowHeight={N} 时 rows 才有意义：行高统一按 rowHeight 计算（瀑布流/错落布局）
import { splitProps, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { type GridColumnCount, clampColumns } from "./grid";

export interface GridSpanProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref" | "style"> {
  /**
   * 跨列数：GridColumnCount（1–12，超出钳制）= grid-column: span N；
   * 'full' = grid-column: 1 / -1（跨满整行）
   */
  columns?: GridColumnCount | "full";
  /** 跨行数：grid-row: span N（配 Grid rowHeight 做瀑布流） */
  rows?: number;
  /** 内容 */
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
  span: {
    minWidth: 0, // 防止 grid item 溢出（长内容/图片默认 min-width: auto）
    display: "grid", // 填满网格单元格并拉伸子项（子项 height: 100% 生效）
    height: "100%",
  },
});

const SPLIT_KEYS = [
  "columns",
  "rows",
  "children",
  "xstyle",
  "style",
  "class",
  "className",
  "ref",
] as const;

/**
 * GridSpan：控制 Grid 网格项跨几列/几行。作为 Grid 的直接子项使用；
 * 不跨行/列时（无 props）等价于普通网格项（仍是 display: grid 的填满容器）。
 */
export function GridSpan(props: GridSpanProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传（id / data-* / aria-* / on* 等）：泛化为 Record 后展开
  const restProps = rest as Record<string, unknown>;

  // 跨列/跨行（内联样式）
  const spanStyle = (): JSX.CSSProperties => {
    const dynamic: JSX.CSSProperties = {};
    const columns = props.columns;
    if (columns != null) {
      dynamic["grid-column"] =
        columns === "full" ? "1 / -1" : `span ${clampColumns(columns)}`;
    }
    if (props.rows != null) {
      dynamic["grid-row"] = `span ${props.rows}`;
    }
    // string style 不参与合并；推荐对象 style 或 xstyle
    return typeof local.style === "object" ? { ...dynamic, ...local.style } : dynamic;
  };

  // 外部 class/className 显式拼接（同 Grid/skeleton：后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className）；style 合并（跨列/跨行内联 + stylex 动态 CSS 变量）
  const mergedAttrs = () => {
    const attrs = stylex.props(baseStyles.span, props.xstyle);
    const mergedStyle: JSX.CSSProperties = {
      ...(attrs.style ?? {}),
      ...spanStyle(),
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

GridSpan.displayName = "GridSpan";