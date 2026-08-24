import { type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";

// 断点常量本地定义（stylex babel 插件不支持跨文件常量解析，值同 theme.stylex.const）
const TABLET = "@media (min-width: 640px) and (max-width: 1024px)";
const DESKTOP = "@media (min-width: 1025px)";
// 平板+桌面合并断点（= theme 的 TABLETANDDESKTOP）：≥640 列数即放开到 8
const TABLET_UP = "@media (min-width: 640px)";

// 12 列网格语言：
// cols 列跨度——数字 1–12；分数为 12 列换算（1/2=6、1/3=4、1/4=3、1/6=2）；
// "full" = gridColumn "1 / -1" 跨满全部显式列（默认）。
// start 起始列——"left"=auto（默认）、数字 2–11、"right"=-1（右对齐）；仅桌面 12 列网格生效。
export type Cols =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  | "1/2" | "1/3" | "1/4" | "1/6"
  | "full";
export type Start = "left" | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | "right";

// —— Container：页面内容容器，限宽 1128px 居中 + 左右留白 + 断点列数（手机 4 / 平板 8 / 桌面 12）——
// 直接写 CSS（不再依赖 Grid 组件）
const styles = stylex.create({
  container: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)", // 手机（移动优先默认）
    [TABLET]: { gridTemplateColumns: "repeat(8, 1fr)" },
    [DESKTOP]: { gridTemplateColumns: "repeat(12, 1fr)" },
    width: "100%",
    maxWidth: 1128, // px
    margin: "0 auto",
    boxSizing: "border-box",
    paddingInline: 16, // 左右留白
    rowGap: 16,
    columnGap: 16,
    gridAutoRows: "minmax(16px, auto)",
  },
  // Block 基础：grid 子项默认 min-width:auto，内容会把轨道撑破（横向溢出/不等宽）。
  // 收窄到 0 让内容在轨道内收缩换行——grid 子项的标准防御写法
  block: {
    minWidth: 0,
  },
  // cols="full"：gridColumn "1 / -1" 跨满全部显式列，任何断点列数下都正确；
  // 不用 span 12——列数小于 12 时 span 会撑出隐式轨道导致错位（见 theme.stylex 注释）
  full: {
    gridColumn: "1 / -1",
  },
});

// —— Block cols 跨度（断点钳制）：span = min(cols, 当前断点列数)——
// 1–4 列各断点（4/8/12）都放得下，无需断点覆盖；
// 5–8 手机钳到 4（全宽），≥640（平板 8 列）放开；
// 9–12 手机钳到 4、平板钳到 8、桌面（12 列）放开到目标值
const colStyles = stylex.create({
  c1: { gridColumnEnd: "span 1" },
  c2: { gridColumnEnd: "span 2" },
  c3: { gridColumnEnd: "span 3" },
  c4: { gridColumnEnd: "span 4" },
  c5: { gridColumnEnd: "span 4", [TABLET_UP]: { gridColumnEnd: "span 5" } },
  c6: { gridColumnEnd: "span 4", [TABLET_UP]: { gridColumnEnd: "span 6" } },
  c7: { gridColumnEnd: "span 4", [TABLET_UP]: { gridColumnEnd: "span 7" } },
  c8: { gridColumnEnd: "span 4", [TABLET_UP]: { gridColumnEnd: "span 8" } },
  c9: { gridColumnEnd: "span 4", [TABLET]: { gridColumnEnd: "span 8" }, [DESKTOP]: { gridColumnEnd: "span 9" } },
  c10: { gridColumnEnd: "span 4", [TABLET]: { gridColumnEnd: "span 8" }, [DESKTOP]: { gridColumnEnd: "span 10" } },
  c11: { gridColumnEnd: "span 4", [TABLET]: { gridColumnEnd: "span 8" }, [DESKTOP]: { gridColumnEnd: "span 11" } },
  c12: { gridColumnEnd: "span 4", [TABLET]: { gridColumnEnd: "span 8" }, [DESKTOP]: { gridColumnEnd: "span 12" } },
  // 分数（12 列换算）：1/2=6（手机全宽、≥640 占 6）；1/3=4、1/4=3、1/6=2（各断点恒等）
  half: { gridColumnEnd: "span 4", [TABLET_UP]: { gridColumnEnd: "span 6" } },
  third: { gridColumnEnd: "span 4" },
  quarter: { gridColumnEnd: "span 3" },
  sixth: { gridColumnEnd: "span 2" },
});

// —— Block start 起始列：12 列桌面语义，仅桌面生效——
// 小屏列数少（4/8），起始列无意义且可能溢出，一律不设（auto 流式放置，配合钳制跨度永不溢出）
const startStyles = stylex.create({
  // 基准 auto（= CSS 默认）必须有：StyleXStyles 类型不接受纯 media 键条目；桌面 media 覆盖基准
  s2: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "2" } },
  s3: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "3" } },
  s4: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "4" } },
  s5: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "5" } },
  s6: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "6" } },
  s7: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "7" } },
  s8: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "8" } },
  s9: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "9" } },
  s10: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "10" } },
  s11: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "11" } },
  right: { gridColumnStart: "auto", [DESKTOP]: { gridColumnStart: "-1" } },
});

/** cols 值 → 静态跨度样式（运行时选择；stylex.create 产物只能静态引用） */
const COL_STYLE: Record<Exclude<Cols, "full">, StyleXStyles> = {
  1: colStyles.c1,
  2: colStyles.c2,
  3: colStyles.c3,
  4: colStyles.c4,
  5: colStyles.c5,
  6: colStyles.c6,
  7: colStyles.c7,
  8: colStyles.c8,
  9: colStyles.c9,
  10: colStyles.c10,
  11: colStyles.c11,
  12: colStyles.c12,
  "1/2": colStyles.half,
  "1/3": colStyles.third,
  "1/4": colStyles.quarter,
  "1/6": colStyles.sixth,
};

/** start 值 → 静态起始列样式（"left"=auto，无样式） */
const START_STYLE: Record<Start, StyleXStyles | undefined> = {
  left: undefined,
  2: startStyles.s2,
  3: startStyles.s3,
  4: startStyles.s4,
  5: startStyles.s5,
  6: startStyles.s6,
  7: startStyles.s7,
  8: startStyles.s8,
  9: startStyles.s9,
  10: startStyles.s10,
  11: startStyles.s11,
  right: startStyles.right,
};

export interface ContainerProps {
  children?: JSX.Element;
  /** StyleX 外部样式：最后合并，可覆盖内部任意属性（命名与全项目 xstyle 约定一致） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 内联样式（作用于根容器） */
  style?: string | JSX.CSSProperties;
}

export interface BlockProps {
  children?: JSX.Element;
  /** 列跨度（12 列语言）@default "full"（1 / -1 全宽） */
  cols?: Cols;
  /** 起始列 @default "left"（auto）；仅桌面 12 列网格生效 */
  start?: Start;
  /** StyleX 外部样式：最后合并，可覆盖内部任意属性（含 gridColumn） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 内联样式（作用于根容器） */
  style?: string | JSX.CSSProperties;
}

/** 页面内容容器：断点列数（手机 4 / 平板 8 / 桌面 12）+ 限宽 1128 居中 + 左右留白 */
export function Container(props: ContainerProps) {
  const attrs = stylex.props(styles.container, props.xstyle);
  const className =
    props.class != null && attrs.className
      ? `${attrs.className} ${props.class}`
      : props.class ?? attrs.className;
  return (
    <div {...attrs} class={className} style={props.style}>
      {props.children}
    </div>
  );
}

/** 网格块：cols 跨度（断点钳制，永不溢出）+ start 起始列（仅桌面）+ xstyle 完全自定义 */
export function Block(props: BlockProps) {
  const cols = props.cols ?? "full";
  const start = props.start ?? "left";
  // full：1 / -1 直接跨满（start 与之矛盾，忽略）；否则 [cols 跨度, start 起始列] 合并
  const grid =
    cols === "full"
      ? styles.full
      : [COL_STYLE[cols], START_STYLE[start]].filter(Boolean);
  const attrs = stylex.props(styles.block, grid, props.xstyle);
  const className =
    props.class != null && attrs.className
      ? `${attrs.className} ${props.class}`
      : props.class ?? attrs.className;
  return (
    <div {...attrs} class={className} style={props.style}>
      {props.children}
    </div>
  );
}
