// Grid（复刻 Astryx Grid：https://astryx.atmeta.com/components/Grid，
// 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
// - CSS Grid 布局容器：固定列数 / 响应式列（auto-fill / auto-fit）+ 可选 max 封顶
// - 轨道模板（grid-template-columns / grid-auto-rows）走 StyleX 动态样式（CSS 变量
//   间接层）：内联只写 --x-* 变量、声明在类里 → 消费方 xstyle 覆盖（含 @media 内）
//   仍能生效；不写裸内联 grid-template-columns（内联会压过一切类）
// - max 封顶数学：上限落在轨道 min 上（min(100%, max(minWidth, perColumn))），
//   轨道 max 恒为 1fr → 列数不超 max、但实际存在的列始终撑满整行（移动端单列不悬空）
// - gap / rowGap / columnGap 档位复用 dialog 的 SpacingStep（0.5/1.5 = 2px/6px，
//   theme.stylex 无此档位）；rowHeight 走 grid-auto-rows，配 GridSpan rows 做瀑布流
// - 间距/对齐走静态类（stylex.create 产物）；width/height 等尺寸走内联样式
import { splitProps, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { dimensions } from "../theme.stylex";
import { type SpacingStep } from "./dialog";

/** Grid 对齐选项（align-items / justify-items） */
export type GridAlignment = "start" | "center" | "end" | "stretch";

/** 列数上限（1–12）：网格系统最多 12 列，超出部分运行时钳制 */
export const GRID_MAX_COLUMNS = 12;

/** 合法列数档位（1–12） */
export type GridColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * 列配置：
 * - `GridColumnCount`（1–12）— 固定等宽列（如 columns={3}，最大 12）
 * - 对象 — 响应式列：
 *   - `minWidth` — 每列轨道最小宽度（px）
 *   - `repeat` — 'fill'（默认）保留空轨道保持宽度一致；'fit' 折叠空轨道让条目拉伸
 *   - `max` — 封顶列数（1–12，超出钳制）。网格始终撑满父容器 100%，且实际存在的
 *     列总是填满整行——移动端塌缩成单列时拉伸到全宽（右侧无空白）
 */
export type GridColumns =
  | GridColumnCount
  | {
      minWidth: number;
      max?: GridColumnCount;
      repeat?: "fill" | "fit";
    };

/** 运行时钳制到 [1, 12]：类型上保证不了动态值时也安全（含取整/兜底） */
export function clampColumns(value: number): number {
  return Math.min(Math.max(Math.floor(value), 1), GRID_MAX_COLUMNS);
}

export interface GridProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref" | "style"> {
  /**
   * 列配置：数字=固定等宽列（1–12，超出钳制）；对象=响应式列
   * （minWidth + 可选 max/repeat，max 上限 12），缺省为单列 1fr
   */
  columns?: GridColumns;
  /** 容器宽度：数字=px，字符串原样（如 '100%'） */
  width?: number | string;
  /** 容器高度：数字=px，字符串原样（如 '100%'） */
  height?: number | string;
  /** 最大宽度：数字=px，字符串原样（如 '100%'） */
  maxWidth?: number | string;
  /** 最小高度：数字=px，字符串原样（如 '100%'） */
  minHeight?: number | string;
  /** 行列统一间距档位（SpacingStep：1 = 4px，2 = 8px…；0.5/1.5 = 2px/6px） */
  gap?: SpacingStep;
  /** 行间距：覆盖 gap 的行轴 */
  rowGap?: SpacingStep;
  /** 列间距：覆盖 gap 的列轴 */
  columnGap?: SpacingStep;
  /**
   * 隐式行轨道高度（px，grid-auto-rows）——配 GridSpan rows={N} 做瀑布流/错落布局：
   * 条目可跨不同行数（高矮不一），行高统一按此值计算
   */
  rowHeight?: number;
  /** 纵向对齐（align-items）@default "stretch" */
  align?: GridAlignment;
  /** 横向对齐（justify-items）@default "stretch" */
  justify?: GridAlignment;
  /** 网格内容 */
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
  grid: {
    display: "grid",
  },
});

// 动态轨道值编译为 CSS 变量 + 类级声明（grid-template-columns: var(--x-*)），而非裸
// 内联样式——否则消费方 xstyle 覆盖（含 @media 内的）永远打不过内联
const dynamicStyles = stylex.create({
  templateColumns: (value: string) => ({
    gridTemplateColumns: value,
  }),
  autoRows: (value: number) => ({
    gridAutoRows: `${value}px`,
  }),
});

const alignStyles = stylex.create({
  start: { alignItems: "start" },
  center: { alignItems: "center" },
  end: { alignItems: "end" },
  stretch: { alignItems: "stretch" },
});

const justifyStyles = stylex.create({
  start: { justifyItems: "start" },
  center: { justifyItems: "center" },
  end: { justifyItems: "end" },
  stretch: { justifyItems: "stretch" },
});

// gap 档位 → 项目 spacing tokens（0.5/1.5 = 2px/6px，token 无此档位，同 dialog padding）
const gapStyles = stylex.create({
  s0: { gap: dimensions.spacing0 },
  s0_5: { gap: "2px" },
  s1: { gap: dimensions.spacing1 },
  s1_5: { gap: "6px" },
  s2: { gap: dimensions.spacing2 },
  s3: { gap: dimensions.spacing3 },
  s4: { gap: dimensions.spacing4 },
  s5: { gap: dimensions.spacing5 },
  s6: { gap: dimensions.spacing6 },
  s8: { gap: dimensions.spacing8 },
  s10: { gap: dimensions.spacing10 },
});

const rowGapStyles = stylex.create({
  s0: { rowGap: dimensions.spacing0 },
  s0_5: { rowGap: "2px" },
  s1: { rowGap: dimensions.spacing1 },
  s1_5: { rowGap: "6px" },
  s2: { rowGap: dimensions.spacing2 },
  s3: { rowGap: dimensions.spacing3 },
  s4: { rowGap: dimensions.spacing4 },
  s5: { rowGap: dimensions.spacing5 },
  s6: { rowGap: dimensions.spacing6 },
  s8: { rowGap: dimensions.spacing8 },
  s10: { rowGap: dimensions.spacing10 },
});

const columnGapStyles = stylex.create({
  s0: { columnGap: dimensions.spacing0 },
  s0_5: { columnGap: "2px" },
  s1: { columnGap: dimensions.spacing1 },
  s1_5: { columnGap: "6px" },
  s2: { columnGap: dimensions.spacing2 },
  s3: { columnGap: dimensions.spacing3 },
  s4: { columnGap: dimensions.spacing4 },
  s5: { columnGap: dimensions.spacing5 },
  s6: { columnGap: dimensions.spacing6 },
  s8: { columnGap: dimensions.spacing8 },
  s10: { columnGap: dimensions.spacing10 },
});

/**
 * spacing 档位 → CSS 值引用（运行时字符串）。整数档是 StyleX token 的 var() 引用
 * （编译期为哈希名，如 var(--x4fmsjb)，不能手写）；0.5/1.5 无 token 档位用 2px/6px
 */
const spacingVarRefs: Record<SpacingStep, string> = {
  0: dimensions.spacing0,
  0.5: "2px",
  1: dimensions.spacing1,
  1.5: "6px",
  2: dimensions.spacing2,
  3: dimensions.spacing3,
  4: dimensions.spacing4,
  5: dimensions.spacing5,
  6: dimensions.spacing6,
  8: dimensions.spacing8,
  10: dimensions.spacing10,
};

/**
 * 构建把列数封顶在 max、同时让实际存在的列仍拉伸填满整行的 grid-template-columns。
 *
 * 封顶落在轨道的 **min** 上而非 max：每列至少
 * perColumn = (100% - (max-1) * gap) / max，超过 max 列永远放不下；轨道 **max** 保持
 * 1fr，因此列数不足 max（尤其移动端只剩一列）时仍撑满整行——右侧无空白。
 *
 * 轨道 min = min(100%, max(minWidth, perColumn))：显式 minWidth 仍被尊重；外层
 * min(100%, …) 保证容器比 minWidth/perColumn 更窄时单列收缩不溢出。
 */
function buildCappedTemplate(
  minWidth: number,
  maxCols: number,
  repeatMode: "auto-fill" | "auto-fit",
  gap: SpacingStep | undefined,
  columnGap: SpacingStep | undefined,
): string {
  const gapRef =
    columnGap != null
      ? spacingVarRefs[columnGap]
      : gap != null
        ? spacingVarRefs[gap]
        : null;

  const perColumn = gapRef
    ? `calc((100% - ${maxCols - 1} * ${gapRef}) / ${maxCols})`
    : `calc(100% / ${maxCols})`;

  const trackMin = `min(100%, max(${minWidth}px, ${perColumn}))`;

  return `repeat(${repeatMode}, minmax(${trackMin}, 1fr))`;
}

const SPLIT_KEYS = [
  "columns",
  "width",
  "height",
  "maxWidth",
  "minHeight",
  "gap",
  "rowGap",
  "columnGap",
  "rowHeight",
  "align",
  "justify",
  "children",
  "xstyle",
  "style",
  "class",
  "className",
  "ref",
] as const;

/**
 * Grid 网格布局容器（两站共享）：固定列 / 响应式列 / max 封顶，间距、对齐、瀑布流行高。
 * 用 CSS Grid 原生能力；语义上只是布局 div，无需额外 ARIA。
 */
export function Grid(props: GridProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传（id / data-* / aria-* / on* 等）：泛化为 Record 后展开
  const restProps = rest as Record<string, unknown>;

  // 轨道模板：运行时字符串（动态样式 → CSS 变量间接层，xstyle/@media 可覆盖）
  const templateColumns = (): string => {
    const columns = props.columns;
    if (typeof columns === "object" && columns != null) {
      // 响应式 API：columns={{minWidth, max?, repeat?}}
      const repeatMode = columns.repeat === "fit" ? "auto-fit" : "auto-fill";

      if (columns.max != null && columns.max > 0) {
        return buildCappedTemplate(
          columns.minWidth,
          clampColumns(columns.max),
          repeatMode,
          props.gap,
          props.columnGap,
        );
      }
      return `repeat(${repeatMode}, minmax(${columns.minWidth}px, 1fr))`;
    }
    if (typeof columns === "number" && columns > 0) {
      // 最多 12 列：超出钳制（columns={13} → repeat(12, 1fr)）
      return `repeat(${clampColumns(columns)}, 1fr)`;
    }
    // 缺省 / columns={0} / 负数 → 单列
    return "1fr";
  };

  // 尺寸（width/height/maxWidth/minHeight）走内联：显式调用方设定，xstyle 不必覆盖
  const sizeStyle = (): JSX.CSSProperties => {
    const inline: JSX.CSSProperties = {};
    const set = (
      key: "width" | "height" | "maxWidth" | "minHeight",
      value: number | string | undefined,
    ) => {
      if (value != null) {
        inline[key === "maxWidth" ? "max-width" : key === "minHeight" ? "min-height" : key] = typeof value === "number" ? `${value}px` : value;
      }
    };
    set("width", props.width);
    set("height", props.height);
    set("maxWidth", props.maxWidth);
    set("minHeight", props.minHeight);
    // string style 不参与合并；推荐对象 style 或 xstyle
    return typeof local.style === "object" ? { ...inline, ...local.style } : inline;
  };

  // stylex.props 条件需静态 key：档位/对齐用 sentinel 比较（同 skeleton/dialog 模式）
  const isGap = (s: SpacingStep) => (props.gap ?? -1) === s;
  const isRowGap = (s: SpacingStep) => (props.rowGap ?? -1) === s;
  const isColumnGap = (s: SpacingStep) => (props.columnGap ?? -1) === s;
  const isAlign = (a: GridAlignment) => (props.align ?? null) === a;
  const isJustify = (a: GridAlignment) => (props.justify ?? null) === a;

  const gridAttrs = () =>
    stylex.props(
      baseStyles.grid,
      dynamicStyles.templateColumns(templateColumns()),
      props.rowHeight != null && dynamicStyles.autoRows(props.rowHeight),
      // gap（11 档）
      isGap(0) && gapStyles.s0,
      isGap(0.5) && gapStyles.s0_5,
      isGap(1) && gapStyles.s1,
      isGap(1.5) && gapStyles.s1_5,
      isGap(2) && gapStyles.s2,
      isGap(3) && gapStyles.s3,
      isGap(4) && gapStyles.s4,
      isGap(5) && gapStyles.s5,
      isGap(6) && gapStyles.s6,
      isGap(8) && gapStyles.s8,
      isGap(10) && gapStyles.s10,
      // rowGap（11 档）
      isRowGap(0) && rowGapStyles.s0,
      isRowGap(0.5) && rowGapStyles.s0_5,
      isRowGap(1) && rowGapStyles.s1,
      isRowGap(1.5) && rowGapStyles.s1_5,
      isRowGap(2) && rowGapStyles.s2,
      isRowGap(3) && rowGapStyles.s3,
      isRowGap(4) && rowGapStyles.s4,
      isRowGap(5) && rowGapStyles.s5,
      isRowGap(6) && rowGapStyles.s6,
      isRowGap(8) && rowGapStyles.s8,
      isRowGap(10) && rowGapStyles.s10,
      // columnGap（11 档）
      isColumnGap(0) && columnGapStyles.s0,
      isColumnGap(0.5) && columnGapStyles.s0_5,
      isColumnGap(1) && columnGapStyles.s1,
      isColumnGap(1.5) && columnGapStyles.s1_5,
      isColumnGap(2) && columnGapStyles.s2,
      isColumnGap(3) && columnGapStyles.s3,
      isColumnGap(4) && columnGapStyles.s4,
      isColumnGap(5) && columnGapStyles.s5,
      isColumnGap(6) && columnGapStyles.s6,
      isColumnGap(8) && columnGapStyles.s8,
      isColumnGap(10) && columnGapStyles.s10,
      // align（align-items）
      isAlign("start") && alignStyles.start,
      isAlign("center") && alignStyles.center,
      isAlign("end") && alignStyles.end,
      isAlign("stretch") && alignStyles.stretch,
      // justify（justify-items）
      isJustify("start") && justifyStyles.start,
      isJustify("center") && justifyStyles.center,
      isJustify("end") && justifyStyles.end,
      isJustify("stretch") && justifyStyles.stretch,
      // 外部注入的 StyleX 样式放最后：与内部样式冲突时外部覆盖
      props.xstyle,
    );

  // 外部 class/className 不能走 rest 透传：Solid 中后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className（内部样式类全部丢失），必须显式拼接；
  // style 合并：stylex 动态样式产生的 CSS 变量（--x-*）与尺寸内联合并后再一次性展开
  // （分开 spread 时后展开的 style 会整体覆盖先展开的 style）
  const mergedAttrs = () => {
    const attrs = gridAttrs();
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

Grid.displayName = "Grid";