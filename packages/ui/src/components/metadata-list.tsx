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

export type MetadataListColumns = "single" | "multi" | number;

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
  },
  title: {
    marginBottom: dimensions.spacing3,
  },
  // dl reset
  dl: {
    margin: 0,
    padding: 0,
  },
  // Vertical — 侧标（position: 'start'）
  gridSingle: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
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
    gridTemplateColumns: "1fr",
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
  // 'multi' 或数字 >1 视为多列
  const isMultiColumn = () =>
    props.columns === "multi" ||
    (typeof props.columns === "number" && props.columns > 1);
  // 标签位置默认：多列 → 'top'，单列 → 'start'
  const labelConfig = () =>
    props.label ?? (isMultiColumn() ? LABEL_TOP : LABEL_START);
  const isHorizontal = () => (props.orientation ?? "vertical") === "horizontal";
  const isStacked = () => labelConfig().position === "top";

  const [isShowAll, setIsShowAll] = createSignal(false);
  const contentId = createUniqueId();
  const { t } = useI18n();

  // 条目（过滤 null/undefined/boolean 并展平，同 React Children.toArray 语义）
  const memoized = memoChildren(() => props.children);
  const allItems = () => memoized.toArray();
  // horizontal 忽略 maxNumOfItems
  const effectiveMax = () =>
    isHorizontal() ? undefined : props.maxNumOfItems;
  const isExceedMax = () =>
    effectiveMax() != null && allItems().length > effectiveMax()!;
  const visibleItems = () =>
    isExceedMax() && !isShowAll()
      ? allItems().slice(0, effectiveMax()!)
      : allItems();

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
    const lc = labelConfig();
    if (typeof props.columns === "number" && props.columns > 1) {
      return isStacked()
        ? `repeat(${props.columns}, 1fr)`
        : `repeat(${props.columns}, auto 1fr)`;
    }
    if (!isStacked() && lc.width != null) {
      const width =
        typeof lc.width === "number" ? `${lc.width}px` : lc.width;
      return `${width} 1fr`;
    }
    return null;
  };
  const gridTemplateColumns = () => getGridTemplateColumns();

  // 外部 class/className 与内部 stylex 类名 + theming 目标类拼接（不能走 rest 透传）
  const mergedClass = () => {
    const attrs = stylex.props(styles.root, props.xstyle);
    const external = local.class ?? local.className;
    const parts = [attrs.className, external, "astryx-metadata-list"].filter(
      Boolean,
    );
    return parts.length > 0 ? { ...attrs, className: parts.join(" ") } : attrs;
  };

  return (
    <MetadataListContext.Provider value={contextValue}>
      <div
        {...restProps}
        data-testid={local["data-testid"]}
        data-columns={String(columns())}
        data-orientation={props.orientation ?? "vertical"}
        style={local.style}
        {...mergedClass()}>
        <Show when={props.title != null}>
          <div {...stylex.props(styles.title)}>{titleNode()}</div>
        </Show>
        <dl
          id={contentId}
          {...stylex.props(styles.dl, getGridStyle())}
          style={
            gridTemplateColumns() != null
              ? { "grid-template-columns": gridTemplateColumns()! }
              : undefined
          }>
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
      </div>
    </MetadataListContext.Provider>
  );
}

MetadataList.displayName = "MetadataList";
