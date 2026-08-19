// Grid（复刻 Astryx Grid：https://astryx.atmeta.com/components/Grid，
// 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
// - CSS Grid 布局容器。所有值类属性统一支持「单值 | 断点对象」：
//   GridBreakpointValue<T> = T | { base, [TABLET]?, [DESKTOP]? }（tablet/desktop 字符串别名等价）
// - 列数两种模式（互斥，columns 优先）：
//   · columns — 固定/断点列数（repeat(N, 1fr)，钳制 1–12）
//   · minColWidth（+ repeat fill/fit + max 封顶）— 内容驱动 auto-fill/auto-fit（无需媒体查询）
// - 轨道模板（grid-template-columns / grid-auto-rows）走 StyleX 动态样式（CSS 变量
//   间接层）：内联只写 --x-* 变量、声明在类里 → 消费方 xstyle 覆盖（含 @media 内）
//   仍能生效；断点覆盖的 @media 规则自带双类特异性（0,2,0），必赢 base 的 var 规则（0,1,0）
// - max 封顶数学：上限落在轨道 min 上（min(100%, max(minColWidth, perColumn))），
//   轨道 max 恒为 1fr → 列数不超 max、但实际存在的列始终撑满整行（移动端单列不悬空）
// - gap / rowGap / columnGap / padding 同支持断点（SpacingStep 档位；0.5/1.5 = 2px/6px，
//   theme.stylex 无此档位）；rowHeight 走 grid-auto-rows，配 GridSpan rows 做瀑布流
// - 间距/对齐走静态类（stylex.create 产物）；width/height 等尺寸走内联样式
import { splitProps, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { dimensions } from "../theme.stylex";
import { type SpacingStep } from "./dialog";

// 断点常量：与 theme.stylex.const 保持同步（stylex 0.19 babel 插件不支持跨文件
// 常量解析，同 theme.stylex.ts / skeleton.tsx 的本地定义惯例）
const TABLET = "@media (640px <= width < 1024px)";
const DESKTOP = "@media (width >= 1024px)";

/** Grid 对齐选项（align-items / justify-items） */
export type GridAlignment = "start" | "center" | "end" | "stretch";

/** 列数上限（1–12）：网格系统最多 12 列，超出部分运行时钳制 */
export const GRID_MAX_COLUMNS = 12;

/** 合法列数档位（1–12） */
export type GridColumnCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/**
 * 断点对象基类（base + 断点覆盖）：
 * - `base` — 默认值（无媒体查询）
 * - `[TABLET]` / `tablet` — 平板（640–1024px）；缺省继承 base
 * - `[DESKTOP]` / `desktop` — 桌面（≥1024px）；缺省继承 tablet → base
 * key 推荐用项目断点常量（`import { TABLET, DESKTOP } from "@dailogues/ui/theme.stylex.const"`），
 * 即 `{ base: 4, [TABLET]: 8, [DESKTOP]: 12 }`；字符串 tablet/desktop 为等价别名。
 * 媒体覆盖走 StyleX 动态样式双类特异性，必赢 base 的 CSS 变量规则。
 */
export interface GridBreakpointsBase<T> {
  base: T;
  [TABLET]?: T;
  [DESKTOP]?: T;
  /** 别名（等价 [TABLET]） */
  tablet?: T;
  /** 别名（等价 [DESKTOP]） */
  desktop?: T;
}

/** 断点列数对象（1–12，超出钳制） */
export type GridBreakpoints = GridBreakpointsBase<GridColumnCount>;

/** 断点值：单值 或 { base, [TABLET]?, [DESKTOP]? }（缺省向小断点继承） */
export type GridBreakpointValue<T> = T | GridBreakpointsBase<T>;

/**
 * 列配置（统一断点值）：
 * - 单值 `GridColumnCount`（1–12）— 固定等宽列（如 columns={3}，最大 12）
 * - 断点对象 `GridBreakpoints` — 断点列数：`{base: 4, [TABLET]: 8, [DESKTOP]: 12}`
 * 内容驱动（auto-fill/auto-fit）改用独立属性：minColWidth / repeat / max
 */
export type GridColumns = GridBreakpointValue<GridColumnCount>;

/** 运行时钳制到 [1, 12]：类型上保证不了动态值时也安全（含取整/兜底） */
export function clampColumns(value: number): number {
  return Math.min(Math.max(Math.floor(value), 1), GRID_MAX_COLUMNS);
}

/**
 * 解析断点值：单值 → {base, tablet: null, desktop: null}；
 * 断点对象 → base + 继承后的 tablet/desktop（与 base 相同的档位归 null，不发射媒体规则）。
 * key 兼容 [TABLET]/[DESKTOP] 常量与 tablet/desktop 字符串别名。
 */
function resolveBreakpointValue<T>(
  value: GridBreakpointValue<T> | undefined,
): { base: T | null; tablet: T | null; desktop: T | null } {
  if (value == null) return { base: null, tablet: null, desktop: null };
  if (typeof value !== "object") return { base: value as T, tablet: null, desktop: null };
  const bp = value as GridBreakpointsBase<T>;
  const base = bp.base;
  const tablet = (bp[TABLET] ?? bp.tablet ?? base) as T;
  const desktop = (bp[DESKTOP] ?? bp.desktop ?? tablet) as T;
  return {
    base,
    tablet: tablet !== base ? tablet : null,
    desktop: desktop !== base ? desktop : null,
  };
}

export interface GridProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref" | "style"> {
  /**
   * 列配置（固定/断点列数模式）：单值（1–12，超出钳制）或断点对象
   * `{base, [TABLET]?, [DESKTOP]?}`。缺省为单列 1fr
   */
  columns?: GridColumns;
  /**
   * 内容驱动模式：每列轨道最小宽度（px），浏览器按容器宽度自动换行
   * （repeat(auto-fill, minmax(minColWidth, 1fr))）。单值或断点对象
   */
  minColWidth?: GridBreakpointValue<number>;
  /**
   * 内容驱动模式：'fill'（默认）保留空轨道宽度一致；'fit' 折叠空轨道让条目拉伸
   * 填满整行。单值或断点对象；仅配合 minColWidth 生效
   */
  repeat?: GridBreakpointValue<"fill" | "fit">;
  /**
   * 内容驱动模式：封顶列数（1–12，超出钳制）。网格撑满父容器，实际存在的列总是
   * 填满整行（移动端单列不悬空）。单值或断点对象；仅配合 minColWidth 生效
   */
  maxCols?: GridBreakpointValue<GridColumnCount>;
  /** 容器宽度：数字=px，字符串原样（如 '100%'） */
  width?: number | string;
  /** 容器高度：数字=px，字符串原样（如 '100%'） */
  height?: number | string;
  /** 最大宽度：数字=px，字符串原样（如 '100%'） */
  maxWidth?: number | string;
  /** 最小高度：数字=px，字符串原样（如 '100%'） */
  minHeight?: number | string;
  /** 行列统一间距：单值或断点对象（GridBreakpointValue<SpacingStep>；1 = 4px，2 = 8px…） */
  gap?: GridBreakpointValue<SpacingStep>;
  /** 行间距：覆盖 gap 的行轴（单值或断点对象） */
  rowGap?: GridBreakpointValue<SpacingStep>;
  /** 列间距：覆盖 gap 的列轴（单值或断点对象） */
  columnGap?: GridBreakpointValue<SpacingStep>;
  /**
   * 隐式行轨道高度（px，grid-auto-rows: Npx，固定）——配 GridSpan rows={N} 做瀑布流。
   * 单值或断点对象
   */
  rowHeight?: GridBreakpointValue<number>;
  /**
   * 隐式行轨道最小高度（px，grid-auto-rows: minmax(Npx, auto)）：行随内容增高，
   * 内容更矮时保持 Npx。单值或断点对象；与 rowHeight 同时传入时优先
   */
  minRowHeight?: GridBreakpointValue<number>;
  /** 容器内边距（四边统一）：单值或断点对象（SpacingStep；1 = 4px，2 = 8px…） */
  padding?: GridBreakpointValue<SpacingStep>;
  /**
   * 水平内边距（padding-inline：左右，RTL 自动镜像）：单值或断点对象；
   * 与 padding 同传时覆盖其水平轴（垂直轴仍用 padding/paddingY）
   */
  paddingX?: GridBreakpointValue<SpacingStep>;
  /** 垂直内边距（padding-block：上下）：单值或断点对象；覆盖 padding 的垂直轴 */
  paddingY?: GridBreakpointValue<SpacingStep>;
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
    // padding 与 width/maxWidth 并存时按 content-box 会在宽度外膨胀（右侧被裁、看似
    // padding 失效）；显式 border-box（同 button/card/dialog 惯例，不依赖 app 级 reset）
    boxSizing: "border-box",
  },
});

// 动态轨道值编译为 CSS 变量 + 类级声明（grid-template-columns: var(--x-*)），而非裸
// 内联样式——否则消费方 xstyle 覆盖（含 @media 内的）永远打不过内联
const dynamicStyles = stylex.create({
  templateColumns: (value: string) => ({
    gridTemplateColumns: value,
  }),
  autoRows: (value: string) => ({
    gridAutoRows: value,
  }),
});

// 断点覆盖：@media 内的 grid-template-columns 走动态样式——编译产物自带双类特异性
// （.x.y:not(#\#)，0,2,0），必赢 base 的 var(--x-*) 规则（0,1,0）
const breakpointStyles = stylex.create({
  tabletCols: (value: string) => ({
    [TABLET]: { gridTemplateColumns: value },
  }),
  desktopCols: (value: string) => ({
    [DESKTOP]: { gridTemplateColumns: value },
  }),
});

// 间距类断点覆盖（gap/rowGap/columnGap/padding × tablet/desktop）
const spacingMediaStyles = stylex.create({
  tabletGap: (value: string) => ({ [TABLET]: { gap: value } }),
  desktopGap: (value: string) => ({ [DESKTOP]: { gap: value } }),
  tabletRowGap: (value: string) => ({ [TABLET]: { rowGap: value } }),
  desktopRowGap: (value: string) => ({ [DESKTOP]: { rowGap: value } }),
  tabletColumnGap: (value: string) => ({ [TABLET]: { columnGap: value } }),
  desktopColumnGap: (value: string) => ({ [DESKTOP]: { columnGap: value } }),
  tabletPaddingInline: (value: string) => ({ [TABLET]: { paddingInline: value } }),
  desktopPaddingInline: (value: string) => ({ [DESKTOP]: { paddingInline: value } }),
  tabletPaddingBlock: (value: string) => ({ [TABLET]: { paddingBlock: value } }),
  desktopPaddingBlock: (value: string) => ({ [DESKTOP]: { paddingBlock: value } }),
});

// 行高断点覆盖（rowHeight / minRowHeight × tablet/desktop；值都是 grid-auto-rows 字符串）
const rowMediaStyles = stylex.create({
  tabletAutoRows: (value: string) => ({ [TABLET]: { gridAutoRows: value } }),
  desktopAutoRows: (value: string) => ({ [DESKTOP]: { gridAutoRows: value } }),
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

// 内边距档位 → 项目 spacing tokens（0.5/1.5 = 2px/6px，token 无此档位，同 dialog）。
// 用逻辑轴长属性（padding-inline / padding-block）而非 padding 简写：paddingX/paddingY
// 与 padding 同传时按轴覆盖，避免简写与子属性同特异性时级联顺序不定
const paddingInlineStyles = stylex.create({
  s0: { paddingInline: dimensions.spacing0 },
  s0_5: { paddingInline: "2px" },
  s1: { paddingInline: dimensions.spacing1 },
  s1_5: { paddingInline: "6px" },
  s2: { paddingInline: dimensions.spacing2 },
  s3: { paddingInline: dimensions.spacing3 },
  s4: { paddingInline: dimensions.spacing4 },
  s5: { paddingInline: dimensions.spacing5 },
  s6: { paddingInline: dimensions.spacing6 },
  s8: { paddingInline: dimensions.spacing8 },
  s10: { paddingInline: dimensions.spacing10 },
});

const paddingBlockStyles = stylex.create({
  s0: { paddingBlock: dimensions.spacing0 },
  s0_5: { paddingBlock: "2px" },
  s1: { paddingBlock: dimensions.spacing1 },
  s1_5: { paddingBlock: "6px" },
  s2: { paddingBlock: dimensions.spacing2 },
  s3: { paddingBlock: dimensions.spacing3 },
  s4: { paddingBlock: dimensions.spacing4 },
  s5: { paddingBlock: dimensions.spacing5 },
  s6: { paddingBlock: dimensions.spacing6 },
  s8: { paddingBlock: dimensions.spacing8 },
  s10: { paddingBlock: dimensions.spacing10 },
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
 * 轨道 min = min(100%, max(minColWidth, perColumn))：显式 minColWidth 仍被尊重；外层
 * min(100%, …) 保证容器比 minColWidth/perColumn 更窄时单列收缩不溢出。
 */
function buildCappedTemplate(
  minColWidth: number,
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

  const trackMin = `min(100%, max(${minColWidth}px, ${perColumn}))`;

  return `repeat(${repeatMode}, minmax(${trackMin}, 1fr))`;
}

/**
 * 内容驱动模板：minColWidth 模式的基础模板（含可选 max 封顶）。
 * gap/columnGap 传该断点层级的档位（缺省 base），封顶 perColumn 计算用其 var 引用
 */
function buildAutoFillTemplate(
  minColWidth: number,
  repeatMode: "fill" | "fit",
  max: number | null,
  gap: SpacingStep | null,
  columnGap: SpacingStep | null,
): string {
  const mode = repeatMode === "fit" ? "auto-fit" : "auto-fill";
  if (max != null) {
    return buildCappedTemplate(minColWidth, max, mode, gap ?? undefined, columnGap ?? undefined);
  }
  return `repeat(${mode}, minmax(${minColWidth}px, 1fr))`;
}

const SPLIT_KEYS = [
  "columns",
  "minColWidth",
  "repeat",
  "maxCols",
  "width",
  "height",
  "maxWidth",
  "minHeight",
  "gap",
  "rowGap",
  "columnGap",
  "padding",
  "paddingX",
  "paddingY",
  "rowHeight",
  "minRowHeight",
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
 * Grid 网格布局容器（两站共享）。所有值类属性统一支持单值 | 断点对象
 * （GridBreakpointValue）；列数模式：columns（固定/断点列数）或
 * minColWidth（内容驱动 auto-fill/auto-fit，可选 max 封顶）二选一，columns 优先。
 * 用 CSS Grid 原生能力；语义上只是布局 div，无需额外 ARIA。
 */
export function Grid(props: GridProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传（id / data-* / aria-* / on* 等）：泛化为 Record 后展开
  const restProps = rest as Record<string, unknown>;

  // 列数模式解析（columns）：base + 继承后的 tablet/desktop（与 base 相同则 null）；
  // 单值或断点对象都走 resolveBreakpointValue；0/负数 → null（回退单列 1fr）
  const resolveColumns = (): {
    base: number;
    tablet: number | null;
    desktop: number | null;
  } | null => {
    const r = resolveBreakpointValue(props.columns);
    if (r.base == null || r.base <= 0) return null;
    const base = clampColumns(r.base);
    const tablet = r.tablet != null ? clampColumns(r.tablet) : null;
    const desktop = r.desktop != null ? clampColumns(r.desktop) : null;
    return {
      base,
      tablet: tablet != null && tablet !== base ? tablet : null,
      desktop: desktop != null && desktop !== base ? desktop : null,
    };
  };

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

  // stylex.props 条件需静态 key：档位/对齐用 sentinel 比较（同 skeleton/dialog 模式）
  const isAlign = (a: GridAlignment) => (props.align ?? null) === a;
  const isJustify = (a: GridAlignment) => (props.justify ?? null) === a;

  const gridAttrs = () => {
    // 统一解析所有断点值（单值 → base；对象 → base + 继承后的 tablet/desktop）
    const cols = resolveColumns();
    const mw = resolveBreakpointValue(props.minColWidth);
    const md = resolveBreakpointValue(props.repeat);
    const mx = resolveBreakpointValue(props.maxCols);
    const gap = resolveBreakpointValue(props.gap);
    const rowGap = resolveBreakpointValue(props.rowGap);
    const columnGap = resolveBreakpointValue(props.columnGap);
    const pad = resolveBreakpointValue(props.padding);
    const padX = resolveBreakpointValue(props.paddingX);
    const padY = resolveBreakpointValue(props.paddingY);
    const rh = resolveBreakpointValue(props.rowHeight);
    const mrh = resolveBreakpointValue(props.minRowHeight);

    // 列数模式：columns（固定/断点列数）优先；否则 minColWidth（内容驱动）；否则单列 1fr
    const countMode = cols != null;
    const autoMode = !countMode && mw.base != null && mw.base > 0;

    // 基础模板（无媒体查询）
    const baseTemplate = (): string => {
      if (countMode) return `repeat(${cols!.base}, 1fr)`;
      if (autoMode) {
        return buildAutoFillTemplate(
          mw.base as number,
          (md.base as "fill" | "fit") ?? "fill",
          mx.base != null ? clampColumns(mx.base) : null,
          gap.base,
          columnGap.base,
        );
      }
      return "1fr";
    };

    // 内容驱动模式的断点模板：minColWidth/repeat/max 任一在断点变化才发射媒体规则
    const autoTemplateAt = (level: "tablet" | "desktop"): string | null => {
      if (!autoMode) return null;
      const mwL = mw[level];
      const mdL = md[level];
      const mxL = mx[level];
      if (mwL == null && mdL == null && mxL == null) return null;
      return buildAutoFillTemplate(
        mwL ?? (mw.base as number),
        (mdL ?? md.base) ?? "fill",
        mxL != null ? clampColumns(mxL) : mx.base != null ? clampColumns(mx.base) : null,
        gap[level] ?? gap.base,
        columnGap[level] ?? columnGap.base,
      );
    };

    // 内边距按轴解析：水平 = paddingX ?? padding，垂直 = paddingY ?? padding（各层继承）
    const inlineAt = (level: "base" | "tablet" | "desktop"): SpacingStep | null => {
      if (level === "base") return padX.base ?? pad.base;
      return padX[level] ?? padX.base ?? pad[level] ?? pad.base;
    };
    const blockAt = (level: "base" | "tablet" | "desktop"): SpacingStep | null => {
      if (level === "base") return padY.base ?? pad.base;
      return padY[level] ?? padY.base ?? pad[level] ?? pad.base;
    };
    const padInlineBase = inlineAt("base");
    const padInlineTablet = inlineAt("tablet");
    const padInlineDesktop = inlineAt("desktop");
    const padBlockBase = blockAt("base");
    const padBlockTablet = blockAt("tablet");
    const padBlockDesktop = blockAt("desktop");

    // 隐式行高解析（minRowHeight 优先；断点继承同其他属性）
    const autoRowsAt = (level: "base" | "tablet" | "desktop"): string | null => {
      const m = level === "base" ? mrh.base : mrh[level] ?? mrh.base;
      const r = level === "base" ? rh.base : rh[level] ?? rh.base;
      if (m != null) return `minmax(${m}px, auto)`;
      if (r != null) return `${r}px`;
      return null;
    };
    const autoRowsBase = autoRowsAt("base");
    const autoRowsTablet = autoRowsAt("tablet");
    const autoRowsDesktop = autoRowsAt("desktop");
    const countTablet = countMode && cols!.tablet != null ? `repeat(${cols!.tablet}, 1fr)` : null;
    const countDesktop = countMode && cols!.desktop != null ? `repeat(${cols!.desktop}, 1fr)` : null;
    const autoTablet = autoTemplateAt("tablet");
    const autoDesktop = autoTemplateAt("desktop");

    return stylex.props(
      baseStyles.grid,
      dynamicStyles.templateColumns(baseTemplate()),
      // 隐式行高（grid-auto-rows）：minRowHeight（minmax，行随内容增高）优先于 rowHeight（固定）；
      // 各自支持断点（tablet/desktop 与 base 不同才发射媒体规则）
      autoRowsBase != null && dynamicStyles.autoRows(autoRowsBase),
      autoRowsTablet != null && autoRowsTablet !== autoRowsBase &&
        rowMediaStyles.tabletAutoRows(autoRowsTablet),
      autoRowsDesktop != null && autoRowsDesktop !== autoRowsBase &&
        rowMediaStyles.desktopAutoRows(autoRowsDesktop),
      // 断点列数（count 模式）：tablet/desktop 覆盖（@media 双类提权）
      countTablet != null && breakpointStyles.tabletCols(countTablet),
      countDesktop != null && breakpointStyles.desktopCols(countDesktop),
      // 内容驱动断点（auto 模式）：minColWidth/repeat/max 变化时覆盖模板
      autoTablet != null && breakpointStyles.tabletCols(autoTablet),
      autoDesktop != null && breakpointStyles.desktopCols(autoDesktop),
      // gap：base 档位 + 断点覆盖
      gap.base === 0 && gapStyles.s0,
      gap.base === 0.5 && gapStyles.s0_5,
      gap.base === 1 && gapStyles.s1,
      gap.base === 1.5 && gapStyles.s1_5,
      gap.base === 2 && gapStyles.s2,
      gap.base === 3 && gapStyles.s3,
      gap.base === 4 && gapStyles.s4,
      gap.base === 5 && gapStyles.s5,
      gap.base === 6 && gapStyles.s6,
      gap.base === 8 && gapStyles.s8,
      gap.base === 10 && gapStyles.s10,
      gap.tablet != null && spacingMediaStyles.tabletGap(spacingVarRefs[gap.tablet]),
      gap.desktop != null && spacingMediaStyles.desktopGap(spacingVarRefs[gap.desktop]),
      // rowGap：base 档位 + 断点覆盖
      rowGap.base === 0 && rowGapStyles.s0,
      rowGap.base === 0.5 && rowGapStyles.s0_5,
      rowGap.base === 1 && rowGapStyles.s1,
      rowGap.base === 1.5 && rowGapStyles.s1_5,
      rowGap.base === 2 && rowGapStyles.s2,
      rowGap.base === 3 && rowGapStyles.s3,
      rowGap.base === 4 && rowGapStyles.s4,
      rowGap.base === 5 && rowGapStyles.s5,
      rowGap.base === 6 && rowGapStyles.s6,
      rowGap.base === 8 && rowGapStyles.s8,
      rowGap.base === 10 && rowGapStyles.s10,
      rowGap.tablet != null && spacingMediaStyles.tabletRowGap(spacingVarRefs[rowGap.tablet]),
      rowGap.desktop != null && spacingMediaStyles.desktopRowGap(spacingVarRefs[rowGap.desktop]),
      // columnGap：base 档位 + 断点覆盖
      columnGap.base === 0 && columnGapStyles.s0,
      columnGap.base === 0.5 && columnGapStyles.s0_5,
      columnGap.base === 1 && columnGapStyles.s1,
      columnGap.base === 1.5 && columnGapStyles.s1_5,
      columnGap.base === 2 && columnGapStyles.s2,
      columnGap.base === 3 && columnGapStyles.s3,
      columnGap.base === 4 && columnGapStyles.s4,
      columnGap.base === 5 && columnGapStyles.s5,
      columnGap.base === 6 && columnGapStyles.s6,
      columnGap.base === 8 && columnGapStyles.s8,
      columnGap.base === 10 && columnGapStyles.s10,
      columnGap.tablet != null && spacingMediaStyles.tabletColumnGap(spacingVarRefs[columnGap.tablet]),
      columnGap.desktop != null && spacingMediaStyles.desktopColumnGap(spacingVarRefs[columnGap.desktop]),
      // padding-inline（左右）/ padding-block（上下）：paddingX/paddingY 覆盖 padding 对应轴
      // （逻辑属性，RTL 自动镜像）
      padInlineBase === 0 && paddingInlineStyles.s0,
      padInlineBase === 0.5 && paddingInlineStyles.s0_5,
      padInlineBase === 1 && paddingInlineStyles.s1,
      padInlineBase === 1.5 && paddingInlineStyles.s1_5,
      padInlineBase === 2 && paddingInlineStyles.s2,
      padInlineBase === 3 && paddingInlineStyles.s3,
      padInlineBase === 4 && paddingInlineStyles.s4,
      padInlineBase === 5 && paddingInlineStyles.s5,
      padInlineBase === 6 && paddingInlineStyles.s6,
      padInlineBase === 8 && paddingInlineStyles.s8,
      padInlineBase === 10 && paddingInlineStyles.s10,
      padInlineTablet != null && padInlineTablet !== padInlineBase &&
        spacingMediaStyles.tabletPaddingInline(spacingVarRefs[padInlineTablet]),
      padInlineDesktop != null && padInlineDesktop !== padInlineBase &&
        spacingMediaStyles.desktopPaddingInline(spacingVarRefs[padInlineDesktop]),
      padBlockBase === 0 && paddingBlockStyles.s0,
      padBlockBase === 0.5 && paddingBlockStyles.s0_5,
      padBlockBase === 1 && paddingBlockStyles.s1,
      padBlockBase === 1.5 && paddingBlockStyles.s1_5,
      padBlockBase === 2 && paddingBlockStyles.s2,
      padBlockBase === 3 && paddingBlockStyles.s3,
      padBlockBase === 4 && paddingBlockStyles.s4,
      padBlockBase === 5 && paddingBlockStyles.s5,
      padBlockBase === 6 && paddingBlockStyles.s6,
      padBlockBase === 8 && paddingBlockStyles.s8,
      padBlockBase === 10 && paddingBlockStyles.s10,
      padBlockTablet != null && padBlockTablet !== padBlockBase &&
        spacingMediaStyles.tabletPaddingBlock(spacingVarRefs[padBlockTablet]),
      padBlockDesktop != null && padBlockDesktop !== padBlockBase &&
        spacingMediaStyles.desktopPaddingBlock(spacingVarRefs[padBlockDesktop]),
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
  };

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