import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { children, splitProps, Show, type JSX } from "solid-js";
import { colors, dimensions } from "../theme.stylex";
import { useMetadataListContext } from "./metadata-list";

/**
 * MetadataListItem（复刻 Astryx MetadataListItem：
 * https://astryx.atmeta.com/components/MetadataListItem，行为对齐参考实现
 * github.com/facebook/astryx，MIT）
 * - 单条键值：<dt>（label）+ <dd>（value）；布局由父 MetadataList 的 labelConfig
 *   /orientation 决定（经 MetadataListContext 下发）：
 *   · 侧标（position='start'，默认单列）：dt/dd 直接作为 dl 的 grid 子项，
 *     两格并排（label 列 auto + value 列 1fr）
 *   · 顶标（position='top' 或多列/横向）：包裹 div（astryx-metadata-list-item）
 *     > dt（堆叠标签）+ dd（堆叠值），纵向排列
 * - icon 渲染在 label 文本前（inline-flex 图标位）
 * - data-testid：顶标模式落到包裹 div；侧标模式拆为 '<id>-label' / '<id>-value'
 * - 变量全部使用 theme.stylex 非废弃 tokens（colors/dimensions）；次要文本色用
 *   onSurface 60% 淡化（项目 muted 约定）
 */

export interface MetadataListItemProps
  extends JSX.HTMLAttributes<HTMLDivElement> {
  /** 内容值 */
  children: JSX.Element;
  /** 渲染在 label 前的图标 */
  icon?: JSX.Element;
  /** 标签文本 */
  label: string;
  /** 外部注入 StyleX 样式（最后合并，冲突时覆盖内部） */
  xstyle?: StyleXStyles;
}

const MUTED = `color-mix(in srgb, ${colors.onSurface} 60%, transparent)`;
const BODY_SIZE = dimensions.fontSizeMd;
const BODY_LEADING = "1.5";

const styles = stylex.create({
  // 侧标 label（dt）
  label: {
    color: MUTED,
    fontSize: BODY_SIZE,
    lineHeight: BODY_LEADING,
    fontWeight: dimensions.fontWeightMedium,
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    margin: 0,
    padding: 0,
    minHeight: dimensions.sizeSm,
    wordBreak: "break-word",
  },
  // 侧标 value（dd）
  value: {
    color: colors.onSurface,
    fontSize: BODY_SIZE,
    lineHeight: BODY_LEADING,
    margin: 0,
    padding: 0,
    minHeight: dimensions.sizeSm,
    wordBreak: "break-word",
  },
  // 顶标包裹层
  stackedWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "2px", // spacing0.5 无 token，内联
  },
  // 顶标 label（dt）
  stackedLabel: {
    color: MUTED,
    fontSize: BODY_SIZE,
    lineHeight: BODY_LEADING,
    fontWeight: dimensions.fontWeightMedium,
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    margin: 0,
    padding: 0,
  },
  // 顶标 value（dd）
  stackedValue: {
    color: colors.onSurface,
    fontSize: BODY_SIZE,
    lineHeight: BODY_LEADING,
    margin: 0,
    padding: 0,
    wordBreak: "break-word",
  },
  iconWrapper: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    color: MUTED,
  },
});

const SPLIT_KEYS = [
  "label",
  "icon",
  "xstyle",
  "style",
  "class",
  "className",
  "data-testid",
  "children",
] as const;

/** 单条元数据键值（两站共享）：复刻 Astryx MetadataListItem；dt/dd 随父列表布局 */
export function MetadataListItem(props: MetadataListItemProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传（ref/aria-* 等）：泛化为 Record 后展开到主元素（dt 或包裹 div）
  const restProps = rest as Record<string, unknown>;

  const ctx = useMetadataListContext();
  // Solid useContext 直接返回 value 对象（contextValue 的 labelConfig/orientation
  // 是 getter，读取即建立响应式依赖）
  const labelPosition = () => ctx?.labelConfig.position ?? "start";
  const isStacked = () =>
    labelPosition() === "top" || ctx?.orientation === "horizontal";

  // lazy JSX prop（icon/title 同理）children() 包装防 hydration mismatch（同 Button）
  const iconNode = children(() => local.icon);

  const labelContent = () => (
    <>
      <Show when={iconNode() != null}>
        <span {...stylex.props(styles.iconWrapper)}>{iconNode()}</span>
      </Show>
      {props.label}
    </>
  );

  // 侧标模式：astryx-metadata-list-item 类 + xstyle + 外部 class 落到 dt
  const mergedClass = () => {
    const attrs = stylex.props(
      isStacked() ? styles.stackedLabel : styles.label,
      props.xstyle,
    );
    const external = local.class ?? local.className;
    const parts = [
      attrs.className,
      external,
      isStacked() ? undefined : "astryx-metadata-list-item",
    ].filter(Boolean);
    return parts.length > 0 ? { ...attrs, className: parts.join(" ") } : attrs;
  };

  // 顶标模式：astryx-metadata-list-item 类 + xstyle + 外部 class 落到包裹 div
  const wrapperClass = () => {
    const attrs = stylex.props(styles.stackedWrapper, props.xstyle);
    const external = local.class ?? local.className;
    const parts = [
      attrs.className,
      external,
      "astryx-metadata-list-item",
    ].filter(Boolean);
    return parts.length > 0 ? { ...attrs, className: parts.join(" ") } : attrs;
  };

  return (
    <Show
      when={isStacked()}
      fallback={
        <>
          <dt
            {...restProps}
            data-testid={
              local["data-testid"] != null
                ? `${local["data-testid"]}-label`
                : undefined
            }
            style={local.style}
            {...mergedClass()}>
            {labelContent()}
          </dt>
          <dd
            data-testid={
              local["data-testid"] != null
                ? `${local["data-testid"]}-value`
                : undefined
            }
            {...stylex.props(styles.value)}>
            {props.children}
          </dd>
        </>
      }>
      <div
        {...restProps}
        data-testid={local["data-testid"]}
        style={local.style}
        {...wrapperClass()}>
        <dt {...stylex.props(styles.stackedLabel)}>{labelContent()}</dt>
        <dd {...stylex.props(styles.stackedValue)}>{props.children}</dd>
      </div>
    </Show>
  );
}

MetadataListItem.displayName = "MetadataListItem";
