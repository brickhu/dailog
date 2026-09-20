import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import {
  children as memoChildren,
  createContext,
  createSignal,
  createUniqueId,
  splitProps,
  Show,
  useContext,
  type JSX,
} from "solid-js";
import { useI18n } from "@dailogues/i18n";
import { colors, dimensions } from "../theme.stylex";

/**
 * MetadataList（复刻 Astryx MetadataList：https://astryx.atmeta.com/components/MetadataList，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 语义结构：根 div（astryx-metadata-list，data-columns/data-orientation）+ 可选 title
 *   + <dl> 列表 + 可选展开/收起按钮；条目渲染为 <dt>/<dd>（APG 键值对语义）
 * - 布局：vertical 用 grid——
 *   · 单列 + 侧标（label.position='start'）：'auto 1fr'（baseline 对齐，8/16px gap）
 *   · 单列 + 顶标（'top'）：'1fr'（12px gap）
 *   · 多列（'multi'）：repeat(auto-fill, minmax(280px, 1fr))（16px gap）
 *   · 数字列（>1）：运行时动态 inline grid-template——顶标 repeat(n, 1fr) /
 *     侧标 repeat(n, auto 1fr)；自定义 label.width（仅侧标生效）→ '<width> 1fr'
 *   · 响应式列数 columns={{ base, "@media …": n }}：任意媒体查询键，断点由调用方定
 *     （组件不写死断点）；列数值经每实例作用域 <style> 写进 --md-cols，内部网格类读该变量
 *   · horizontal：flex row + wrap，强制顶标，忽略 columns/label/maxNumOfItems
 * - maxNumOfItems（仅 vertical 生效）：条目数超出时默认折叠，出现
 *   "Show more/Show less" 切换按钮（aria-expanded + aria-controls 指向 dl，
 *   文案走 @dailogues/i18n 词典 metadataList.showMore/showLess）
 * - 折叠实现：children() + toArray()（过滤 null/undefined/boolean 并展平，
 *   与 React Children.toArray 语义一致，同 carousel.tsx）后按引用切片
 * - label.position 默认：多列 → 'top'，单列 → 'start'；horizontal 强制 'top'
 * - 条目通过 MetadataListContext 拿到 labelConfig/orientation（Solid context）
 * - 变量全部使用 theme.stylex 非废弃 tokens（colors/dimensions）；无 accent token，
 *   按钮强调色用 colors.secondary（项目 link/accent 约定）
 */

/** 响应式列数：base = 默认列数（没有媒体查询命中时），其余键为**任意媒体查询**，值为该断点下的列数。
 *  @example columns={{ base: 1, "@media (min-width: 900px)": 2 }} */
export interface MetadataListResponsiveColumns {
  base?: number;
  [mediaQuery: string]: number | undefined;
}

export type MetadataListColumns =
  | "single"
  | "multi"
  | number
  | MetadataListResponsiveColumns;


export interface MetadataListLabelConfig {
  position: "start" | "top";
  width?: number | string;
}

export interface MetadataListContextValue {
  labelConfig: MetadataListLabelConfig;
  orientation: "vertical" | "horizontal";
}

export interface MetadataListProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "title"> {
  /** 元数据条目（MetadataListItem 组件） */
  children: JSX.Element;
  /** 列布局模式 @default "single" */
  columns?: MetadataListColumns;
  /** 标签显示配置：position 控制标签位置（start=左侧 / top=堆叠），width 自定义标签列宽（仅侧标生效）
   *  @default { position: "start" }（单列）/ { position: "top" }（多列） */
  label?: MetadataListLabelConfig;
  /** 折叠前最多显示的条目数；超出后出现 "显示更多/显示更少" 切换（仅 vertical 生效） */
  maxNumOfItems?: number;
  /** 布局方向：vertical=纵向 grid / horizontal=横向 flex 换行（忽略 columns/label/maxNumOfItems） @default "vertical" */
  orientation?: "vertical" | "horizontal";
  /** 列表上方的可选标题 */
  title?: JSX.Element;
  /** 外部注入 StyleX 样式（最后合并，冲突时覆盖内部） */
  xstyle?: StyleXStyles;
}

const MetadataListContext = createContext<MetadataListContextValue | undefined>(undefined);

/** 条目读取父列表的 labelConfig/orientation（无 Provider 时回退 'start'/vertical） */
export function useMetadataListContext(): MetadataListContextValue | undefined {
  return useContext(MetadataListContext);
}

const LABEL_START: MetadataListLabelConfig = { position: "start" };
const LABEL_TOP: MetadataListLabelConfig = { position: "top" };

// 次要文本：项目 muted 约定（text-input --ti-muted 同为 onSurface 60%）
const MUTED = `color-mix(in srgb, ${colors.onSurface} 60%, transparent)`;
const BODY_SIZE = dimensions.fontSizeMd;
const BODY_LEADING = "1.5";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    // 撑满父容器（与 banner/card/slider/text-input 一致）：作为 flex 子项时，父级若是
    // align-items:flex-start 会被收缩成 fit-content —— 多列 grid 就挤成窄条。
    // 需要按内容收缩的调用方可用 xstyle 覆盖。
    width: "100%",
  },
  title: {
    // 标题 ↔ 第一条的间距 = item 之间的间距（16px，同一节奏；多列/响应式路径的 gap 都是 spacing4）
    marginBottom: dimensions.spacing4,
    // 无标题时（titleNode 插入 undefined）该 div 完全为空 → 不占间距。
    // 不能用 <Show when={props.title != null}> 做条件：见下方 title 渲染处注释。
    ":empty": { display: "none" },
  },
  // dl reset
  dl: {
    margin: 0,
    padding: 0,
  },
  // Vertical — 侧标（position: 'start'）
  // 列数的公开控制点：--md-cols（继承自根，可用 xstyle + 任意媒体查询在外层设置）。
  // 不设变量时 = 1 列，等价于原来的 auto 1fr / 1fr
  gridSingle: {
    display: "grid",
    gridTemplateColumns: "repeat(var(--md-cols, 1), auto 1fr)",
    gap: `${dimensions.spacing2} ${dimensions.spacing4}`,
    alignItems: "baseline",
  },
  gridMulti: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: dimensions.spacing4,
  },
  // Vertical — 顶标（position: 'top'）
  gridStackedSingle: {
    display: "grid",
    gridTemplateColumns: "repeat(var(--md-cols, 1), 1fr)",
    gap: dimensions.spacing3,
  },
  gridStackedMulti: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: dimensions.spacing4,
  },
  // Horizontal — flex 行 + 换行
  horizontal: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: dimensions.spacing4,
  },
  // columns 传对象（媒体查询键）时用：列数读 --md-cols（组件注入的作用域样式按
  // base / 各媒体查询写入）。侧标形态每列是 "[标签列] 1fr"，标签列宽经 --md-label-w
  // 覆盖（未设 = auto）——两者都是 CSS 变量，所以任意列数/任意标签宽都不需要新类
  colsByVarStacked: {
    display: "grid",
    gap: dimensions.spacing4,
    gridTemplateColumns: "repeat(var(--md-cols, 1), 1fr)",
  },
  colsByVarStart: {
    display: "grid",
    gap: dimensions.spacing4,
    gridTemplateColumns: "repeat(var(--md-cols, 1), var(--md-label-w, auto) 1fr)",
  },
  // 展开/收起按钮
  toggleButton: {
    appearance: "none",
    background: "none",
    border: "none",
    padding: `${dimensions.spacing2} 0`,
    cursor: "pointer",
    color: colors.secondary,
    fontSize: BODY_SIZE,
    lineHeight: BODY_LEADING,
    fontWeight: dimensions.fontWeightMedium,
    fontFamily: "inherit",
    textAlign: "start",
    alignSelf: "flex-start",
  },
});

const SPLIT_KEYS = [
  "columns",
  "label",
  "maxNumOfItems",
  "orientation",
  "title",
  "xstyle",
  "style",
  "class",
  "className",
  "data-testid",
] as const;

/** 只读键值元数据列表（两站共享）：复刻 Astryx MetadataList 行为；dl/dt/dd + 多列/横向/折叠 */
export function MetadataList(props: MetadataListProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传（ref/data-*/aria-* 等）：泛化为 Record 后展开
  const restProps = rest as Record<string, unknown>;

  const columns = () => props.columns ?? "single";
  // 响应式列数（对象形态）：{ base, "@media …": n } → { base, rules[], max }
  // 非 "base" 且不是 @media 开头的键会被忽略（并 warn，避免写错静默失效）
  const respCols = () => {
    const c = props.columns;
    if (c == null || typeof c !== "object") return undefined;
    const rules: Array<{ query: string; count: number }> = [];
    let max = c.base ?? 1;
    for (const [key, value] of Object.entries(c)) {
      if (key === "base" || typeof value !== "number") continue;
      const query = key.trim();
      if (!query.startsWith("@media")) {
        if (typeof console !== "undefined") {
          console.warn(
            '[MetadataList] columns 的键 "' + key + '" 已忽略：请用媒体查询键，例如 "@media (min-width: 900px)"',
          );
        }
        continue;
      }
      rules.push({ query, count: value });
      max = Math.max(max, value);
    }
    return { base: c.base ?? 1, rules, max };
  };
  // 'multi'、数字 >1、或响应式里任一档 >1 → 视为多列（标签堆叠）
  const isMultiColumn = () => {
    if (props.columns === "multi") return true;
    if (typeof props.columns === "number") return props.columns > 1;
    const r = respCols();
    return r != null && r.max > 1;
  };
  // 标签位置默认：多列 → 'top'，单列 → 'start'
  const labelConfig = () =>
    props.label ?? (isMultiColumn() ? LABEL_TOP : LABEL_START);
  const isHorizontal = () => (props.orientation ?? "vertical") === "horizontal";
  const isStacked = () => labelConfig().position === "top";

  // horizontal 忽略 maxNumOfItems（条目展开/折叠逻辑在 MetadataListItems 内 —— 必须
  // 在 Context.Provider 之内 materialize children，见该组件注释）
  const effectiveMax = () =>
    isHorizontal() ? undefined : props.maxNumOfItems;

  // 传给条目的配置：horizontal 强制顶标
  const contextValue: MetadataListContextValue = {
    get labelConfig() {
      return isHorizontal() ? LABEL_TOP : labelConfig();
    },
    get orientation() {
      return isHorizontal() ? "horizontal" : "vertical";
    },
  };

  const titleNode = memoChildren(() => props.title);

  // 基础 grid 规则（数字列/自定义宽度的精确 template 走下方动态 inline）
  const getGridStyle = () => {
    if (isHorizontal()) return styles.horizontal;
    if (respCols() != null) {
      return isStacked() ? styles.colsByVarStacked : styles.colsByVarStart;
    }
    const c = columns();
    if (isStacked()) {
      return c === "single" || c === 1
        ? styles.gridStackedSingle
        : styles.gridStackedMulti;
    }
    return c === "single" || c === 1 ? styles.gridSingle : styles.gridMulti;
  };

  // 运行时 grid-template-columns：数字列（顶标 repeat(n,1fr) / 侧标 repeat(n, auto 1fr)）
  // 与自定义 label.width（仅侧标，'<width> 1fr'）——运行时值走 inline style（同 skeleton）
  const getGridTemplateColumns = () => {
    if (isHorizontal()) return null;
    // 响应式列数由 colsByVar + 注入的作用域样式（--md-cols）负责
    if (respCols() != null) return null;
    const lc = labelConfig();
    // 侧标每列的轨道：自定义 label.width -> "<width> 1fr"，否则 auto 1fr（堆叠形态无标签列）
    const startTrack = () => {
      if (isStacked()) return "1fr";
      if (lc.width == null) return "auto 1fr";
      const width =
        typeof lc.width === "number" ? `${lc.width}px` : lc.width;
      return `${width} 1fr`;
    };
    if (typeof props.columns === "number" && props.columns > 1) {
      return `repeat(${props.columns}, ${startTrack()})`;
    }
    if (!isStacked() && lc.width != null) return startTrack();
    return null;
  };
  // <dl> 的运行时 inline style：响应式走注入的作用域样式（colsCss），
  // 其余走精确 grid-template-columns
  const dlStyle = (): JSX.CSSProperties | undefined => {
    if (respCols() != null) {
      // 侧标形态的标签列宽（堆叠形态忽略 width）
      const lc = labelConfig();
      if (!isStacked() && lc.width != null) {
        return {
          "--md-label-w":
            typeof lc.width === "number" ? lc.width + "px" : lc.width,
        } as JSX.CSSProperties;
      }
      return undefined;
    }
    const gtc = getGridTemplateColumns();
    return gtc != null
      ? ({ "grid-template-columns": gtc } as JSX.CSSProperties)
      : undefined;
  };

  // 响应式列数的作用域：每个实例一个类名 + 一段注入样式，把 base / 各媒体查询的列数
  // 写进 --md-cols（基础网格类都读它）——任意断点都不需要新增 stylex 类
  const colsScope = "md-cols-" + createUniqueId().replace(/[^a-zA-Z0-9_-]/g, "");
  const colsCss = () => {
    const r = respCols();
    if (r == null || r.rules.length === 0) return null;
    let css = "." + colsScope + "{--md-cols:" + r.base + "}";
    for (const rule of r.rules) {
      css += rule.query + "{." + colsScope + "{--md-cols:" + rule.count + "}}";
    }
    return css;
  };
  // data-columns（theming/调试用）：数字/字符串原样，响应式 → "base/各档列数"
  const columnsLabel = () => {
    const r = respCols();
    if (r == null) return String(columns());
    return [String(r.base), ...r.rules.map((x) => String(x.count))].join("/");
  };

  // 外部 class/className 与内部 stylex 类名 + theming 目标类拼接（不能走 rest 透传）
  const mergedClass = () => {
    const attrs = stylex.props(styles.root, props.xstyle);
    const external = local.class ?? local.className;
    const parts = [
      attrs.className,
      external,
      "astryx-metadata-list",
      respCols() != null ? colsScope : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? { ...attrs, className: parts.join(" ") } : attrs;
  };

  return (
    <MetadataListContext.Provider value={contextValue}>
      <div
        {...restProps}
        data-testid={local["data-testid"]}
        data-columns={columnsLabel()}
        data-orientation={props.orientation ?? "vertical"}
        style={local.style}
        {...mergedClass()}>
        {/* 响应式列数（columns 传对象时）：把 base / 各媒体查询的列数写进本实例作用域类
            上的 --md-cols，供内部网格类读取。仅该形态才渲染（其余形态无额外节点）。 */}
        <Show when={colsCss()}>{(css) => <style>{css()}</style>}</Show>
        {/* title 是惰性 JSX prop（title={<div/>}）：**禁止**在渲染前读它做条件
            （<Show when={props.title != null}> 会多 materialize 一次）。
            SSR 在「元素创建」时分配 hydration key、客户端在「插入」时分配 —— 条件里
            多读一次会让两边 key 错位：Hydration Mismatch ... <div>标题</div>。
            这里只经 titleNode()（children() memo）读一次，并在插入位置渲染；
            无标题时空 div 由 styles.title 的 :empty 收掉。 */}
        <div {...stylex.props(styles.title)}>{titleNode()}</div>
        <MetadataListItems
          maxNumOfItems={effectiveMax()}
          dlAttrs={stylex.props(styles.dl, getGridStyle())}
          dlStyle={dlStyle()}>
          {props.children}
        </MetadataListItems>
      </div>
    </MetadataListContext.Provider>
  );
}

MetadataList.displayName = "MetadataList";

/**
 * 条目区（内部组件）：**必须独立成组件、且渲染在 MetadataListContext.Provider 之内**。
 *
 * 原因：Solid 的组件是普通函数调用 —— JSX 一被求值，MetadataListItem 的组件体就执行，
 * 其中的 useContext(MetadataListContext) 按"创建它的 owner"解析。原实现在 MetadataList
 * 组件体里就把 children() 求值了（为了 toArray 计数），此时 Provider 还没建 → 条目拿到的
 * ctx 是 undefined → labelPosition 回退 start（侧标）→
 *   · columns={2} / columns="multi" 只有 dl 的 grid 列数生效，条目仍是一行一个「标签|值」，
 *     表现出来就是"columns 无效"；
 *   · orientation="horizontal" 的"强制顶标"与 label={{position:'top'}} 同样不生效。
 * 放到 Provider 内部求值后，条目渲染形态才与 dl 的 grid/flex 布局一致。
 */
function MetadataListItems(props: {
  children?: JSX.Element;
  /** undefined = 不折叠（horizontal） */
  maxNumOfItems?: number;
  /** 父级算好的 <dl> 属性（grid 规则随 columns/orientation 变化） */
  dlAttrs: { className?: string; style?: JSX.CSSProperties };
  /** <dl> 的运行时 inline style（响应式列数的 CSS 变量，或精确 grid-template-columns） */
  dlStyle?: JSX.CSSProperties;
}) {
  const { t } = useI18n();
  const contentId = createUniqueId();
  const [isShowAll, setIsShowAll] = createSignal(false);

  // 条目（过滤 null/undefined/boolean 并展平，同 React Children.toArray 语义）——
  // 在这里求值 = 在 Provider 之内实例化 MetadataListItem，条目才读得到 ctx
  const memoized = memoChildren(() => props.children);
  const allItems = () => memoized.toArray();
  const isExceedMax = () =>
    props.maxNumOfItems != null && allItems().length > props.maxNumOfItems;
  const visibleItems = () =>
    isExceedMax() && !isShowAll()
      ? allItems().slice(0, props.maxNumOfItems)
      : allItems();

  return (
    <>
      <dl id={contentId} {...props.dlAttrs} style={props.dlStyle}>
        {visibleItems()}
      </dl>
      <Show when={isExceedMax()}>
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={isShowAll()}
          onClick={() => setIsShowAll((v) => !v)}
          {...stylex.props(styles.toggleButton)}>
          {isShowAll()
            ? t("metadataList.showLess")
            : t("metadataList.showMore")}
        </button>
      </Show>
    </>
  );
}
