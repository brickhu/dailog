import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import {
  children,
  createEffect,
  createSignal,
  createUniqueId,
  splitProps,
  type Component,
  type JSX,
} from "solid-js";
import { colors, dimensions, durations, easings, fontfamilies } from "@dailogues/ui/theme.stylex";
import { Icon } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

/**
 * SideNav 家族（复刻 Astryx SideNav/SideNavSection/SideNavItem：
 * https://astryx.atmeta.com/components/SideNav，行为对齐参考实现
 * github.com/facebook/astryx，MIT）
 * - SideNav：纵向导航容器，五个区域——header + topContent（顶部吸顶）、children（可滚动）、
 *   footer + footerIcons（底部吸顶）。本复刻不含桌面侧栏的折叠（collapsible）/拖拽调宽
 *   （resizable）特性（移动端抽屉场景不需要），接口保持精简
 * - SideNavSection：一级分组——带标题（role="group" + aria-labelledby）的导航条目组
 * - SideNavItem：二级条目——链接（href，可经 as 传入路由组件）或按钮，支持图标/选中态/
 *   （aria-current="page"）/禁用态/尾部内容，以及可折叠的嵌套子项（二级纵向菜单：
 *   父条目点击展开/收起子条目，aria-expanded + aria-controls + grid-rows 动画，
 *   尊重 prefers-reduced-motion）。折叠触发器带 data-sidenav-toggle 标记，
 *   消费方"点击关闭 drawer"的监听可用它排除折叠切换（同 data-menu-trigger 约定）
 * - 选中视觉沿用站点品牌绿（brandStrong + 浅绿底），与桌面行内导航高亮一致
 */

// ============ 共享样式 ============

const HOVER_BG = `color-mix(in srgb, ${colors.surfaceStrong} 55%, transparent)`;
const PRESSED_BG = `color-mix(in srgb, ${colors.surfaceStrong} 75%, transparent)`;
const SELECTED_BG = `color-mix(in srgb, ${colors.brand} 14%, transparent)`;
const SELECTED_BG_HOVER = `color-mix(in srgb, ${colors.brand} 22%, transparent)`;

const navItemStyles = stylex.create({
  item: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    width: "100%",
    height: dimensions.sizeMd,
    paddingInline: dimensions.spacing2,
    paddingBlock: 0,
    borderRadius: dimensions.radiusMd,
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: colors.foreground,
    textDecoration: "none",
    cursor: "pointer",
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
    textAlign: "start",
    boxSizing: "border-box",
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: HOVER_BG },
    },
    ":active": { backgroundColor: PRESSED_BG },
  },
  selected: {
    backgroundColor: SELECTED_BG,
    color: colors.brandStrong,
    fontWeight: dimensions.fontWeightMedium,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": { backgroundColor: SELECTED_BG_HOVER },
    },
    ":active": { backgroundColor: SELECTED_BG_HOVER },
  },
  disabled: {
    color: colors.neutral,
    cursor: "not-allowed",
    pointerEvents: "none",
  },
  sm: { height: dimensions.sizeSm, paddingInline: dimensions.spacing1, fontSize: dimensions.fontSizeXs },
  md: { height: dimensions.sizeMd, paddingInline: dimensions.spacing2 },
  lg: { height: dimensions.sizeLg, paddingInline: dimensions.spacing2, fontSize: dimensions.fontSizeMd },
  label: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  endContent: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  iconSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: dimensions.spacing6,
    height: dimensions.spacing6,
    flexShrink: 0,
    fontSize: "inherit",
    transitionProperty: "transform",
    transitionDuration: durations.durationFast,
    transitionTimingFunction: easings.easeInOut,
    "@media (prefers-reduced-motion: reduce)": { transitionDuration: "0s" },
  },
  chevronExpanded: { transform: "rotate(180deg)" },
  expandToggle: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
    margin: 0,
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
    borderRadius: dimensions.radiusSm,
    ":hover": { backgroundColor: HOVER_BG },
    ":active": { backgroundColor: PRESSED_BG },
  },
  // 条目根容器：纵向排列（行元素在上、嵌套子项在下）
  itemRoot: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
  },
  // split-action 行：主操作元素 + 独立折叠按钮横排
  splitRow: {
    display: "flex",
    alignItems: "center",
    width: "100%",
  },
  splitAction: {
    display: "flex",
    alignItems: "center",
    alignSelf: "stretch",
    gap: dimensions.spacing2,
    flex: 1,
    minWidth: 0,
  },
  children: {
    display: "grid",
    gridTemplateRows: "1fr",
    transitionProperty: "grid-template-rows",
    transitionDuration: durations.durationMediumMin,
    transitionTimingFunction: easings.easeInOut,
    "@media (prefers-reduced-motion: reduce)": { transitionDuration: "0s" },
  },
  childrenCollapsed: { gridTemplateRows: "0fr" },
  childrenInner: {
    overflow: "hidden",
    minHeight: 0,
    paddingInlineStart: dimensions.spacing6,
  },
  childrenLabel: { display: "none" },
});

const sectionStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: dimensions.spacing1,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    paddingInline: dimensions.spacing2,
    paddingBlock: dimensions.spacing1,
    cursor: "default",
    userSelect: "none",
  },
  titleContainer: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  title: {
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightSemiBold,
    lineHeight: "1.5",
    color: colors.neutral,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  subtitle: {
    fontSize: dimensions.fontSizeXs,
    lineHeight: "1.5",
    color: colors.neutral,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  endContent: { flexShrink: 0, display: "flex", alignItems: "center" },
  items: { display: "flex", flexDirection: "column", gap: dimensions.spacing1 },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});

const navStyles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: 260,
    boxSizing: "border-box",
    overflow: "hidden",
  },
  stickyTop: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "sticky",
    top: 0,
    zIndex: 1,
    gap: dimensions.spacing2,
    paddingBlockStart: dimensions.spacing2,
    paddingBlockEnd: dimensions.spacing2,
    paddingInline: dimensions.spacing2,
  },
  topContent: {},
  scrollable: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    paddingInline: dimensions.spacing2,
    paddingBlockStart: dimensions.spacing2,
    paddingBlockEnd: dimensions.spacing2,
  },
  scrollableWithTop: { paddingBlockStart: dimensions.spacing1 },
  scrollableWithBottom: { paddingBlockEnd: dimensions.spacing1 },
  stickyBottom: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    marginTop: "auto",
    position: "sticky",
    bottom: 0,
    gap: dimensions.spacing2,
    paddingInline: dimensions.spacing2,
    paddingBlockStart: dimensions.spacing1,
    paddingBlockEnd: dimensions.spacing2,
  },
  footerRow: { display: "flex", alignItems: "center", gap: dimensions.spacing1 },
});

// ============ Types ============

export interface SideNavProps {
  /** 顶部吸顶区（通常放品牌标题） */
  header?: JSX.Element;
  /** 顶部吸顶区下方的固定内容（如创建按钮） */
  topContent?: JSX.Element;
  /** 导航分区与条目（可滚动） */
  children: JSX.Element;
  /** 底部吸顶区（页脚内容） */
  footer?: JSX.Element;
  /** 底部图标行 */
  footerIcons?: JSX.Element;
  /** 导航地标可访问名称 @default t("mobileNav.navigation") */
  label?: string;
  /** 外部注入的 StyleX 样式（最后合并、冲突时覆盖内部）；抽屉内可用它覆盖宽度为 100% */
  xstyle?: StyleXStyles;
  class?: string;
  className?: string;
  style?: JSX.CSSProperties;
}

export interface SideNavSectionProps {
  /** 一级分组标题 */
  title: string;
  /** 标题副文本 */
  subtitle?: string;
  /** 分组内条目 */
  children: JSX.Element;
  /** 标题行右侧内容 */
  endContent?: JSX.Element;
  /** 标题视觉隐藏（屏幕阅读器仍可读）@default false */
  isHeaderHidden?: boolean;
  /** 外部注入的 StyleX 样式 */
  xstyle?: StyleXStyles;
}

export type SideNavItemSize = "sm" | "md" | "lg";

export interface SideNavItemCollapsibleConfig {
  /** 初始是否收起 @default false */
  defaultIsCollapsed?: boolean;
  /** 受控收起态 */
  isCollapsed?: boolean;
  onCollapsedChange?: (isCollapsed: boolean) => void;
}

export interface SideNavItemProps
  extends Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "onClick" | "label" | "ref"> {
  /** 条目文本 */
  label: string;
  /** 图标（JSX 元素，如 <Icon/>） */
  icon?: JSX.Element;
  /** 选中态图标（可选，选中时替换 icon） */
  selectedIcon?: JSX.Element;
  /** 当前页指示（aria-current="page"）@default false */
  isSelected?: boolean;
  /** 禁用 @default false */
  isDisabled?: boolean;
  /** 链接地址；提供时渲染为链接（as 提供时用 as），否则为按钮 */
  href?: string;
  /** 自定义链接组件（如 @solidjs/router 的 A，SPA 导航用） */
  as?: Component<any>;
  onClick?: (e: MouseEvent) => void;
  /** 尾部内容（角标/计数） */
  endContent?: JSX.Element;
  /** 嵌套子条目（二级纵向菜单）；默认可折叠 */
  children?: JSX.Element;
  /** 折叠配置：true=可折叠（默认展开）；对象=受控/初始收起；false=禁用折叠 */
  collapsible?: boolean | SideNavItemCollapsibleConfig;
  /** 尺寸 @default "md" */
  size?: SideNavItemSize;
  /** 外部注入的 StyleX 样式 */
  xstyle?: StyleXStyles;
  /** 外部 class（与内部 stylex 类名拼接不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
}

const NAV_ITEM_SPLIT_KEYS = [
  "label", "icon", "selectedIcon", "isSelected", "isDisabled", "href", "as", "onClick",
  "endContent", "children", "collapsible", "size", "xstyle", "class", "className", "style",
] as const;

// ============ SideNavItem ============

/**
 * 纵向导航条目（二级）：链接或按钮，支持图标/选中/禁用/尾部内容/嵌套子项。
 * 子项默认可折叠（collapsible !== false）：无独立主操作时点击整行切换，
 * 有 href/onClick 时点击行触发主操作、点右侧箭头切换（split-action）。
 */
export function SideNavItem(props: SideNavItemProps) {
  const { t } = useI18n();
  const [local, rest] = splitProps(props, NAV_ITEM_SPLIT_KEYS);
  const id = createUniqueId();
  // lazy props（icon={<Icon/>} 等 JSX 元素）必须 children() 包装：Solid 1.9 hydration 下
  // 组件 key 分配与 SSR 不一致会报 Hydration Mismatch（同 Button 的 icon 处理）
  const iconNode = children(() => local.icon);
  const selectedIconNode = children(() => local.selectedIcon);
  const endContentNode = children(() => local.endContent);
  const config = () => (typeof local.collapsible === "object" ? local.collapsible : {});
  const hasChildren = () => local.children != null;
  const isItemCollapsible = () => hasChildren() && local.collapsible !== false;
  const [collapsed, setCollapsed] = createSignal(
    config().isCollapsed ?? config().defaultIsCollapsed ?? false,
  );
  // 受控模式：外部 isCollapsed 变化时同步内部信号
  createEffect(() => {
    const controlled = config().isCollapsed;
    if (controlled !== undefined) setCollapsed(controlled);
  });
  const toggle = () => {
    const next = !collapsed();
    if (config().isCollapsed === undefined) setCollapsed(next);
    config().onCollapsedChange?.(next);
  };
  // stylex.props 条件：取正判断包成调用表达式（0.19 不支持一元 ! / 调用开头的 3 元链）
  const isCollapsedState = () => collapsed() === true;
  const isExpanded = () => collapsed() === false;
  const isSize = (s: SideNavItemSize) => (props.size ?? "md") === s;
  const isSelected = () => props.isSelected === true;
  const isDisabled = () => props.isDisabled === true;
  const hasPrimaryAction = () => local.href != null || local.onClick != null;
  const hasIndependentToggle = () => isItemCollapsible() && hasPrimaryAction();
  // 折叠触发器元素标记：消费方"点击关闭 drawer"的监听用它排除折叠切换
  const toggleMarker = () => (isItemCollapsible() ? { "data-sidenav-toggle": "true" } : {});

  const handleClick = (e: MouseEvent) => {
    if (isDisabled()) {
      e.preventDefault();
      return;
    }
    // 无独立主操作的可折叠条目：整行点击切换展开/收起（不触发 onClick）
    if (isItemCollapsible() && !hasIndependentToggle()) {
      e.preventDefault();
      toggle();
      return;
    }
    local.onClick?.(e);
  };

  const handleToggleClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  };

  const displayIcon = () =>
    isSelected() && selectedIconNode() != null ? selectedIconNode() : iconNode();
  // stylex.props 条件不支持一元 ! / 调用开头的 3 元链——正判断包成调用表达式
  const isRowToggle = () => isItemCollapsible() && hasIndependentToggle() === false;
  const chevron = (isExpanded: boolean) => (
    <span
      {...stylex.props(
        navItemStyles.chevron,
        isExpanded && navItemStyles.chevronExpanded,
      )}
    >
      <Icon icon="iconoir:nav-arrow-down" width={14} height={14} />
    </span>
  );
  const itemContent = () => (
    <>
      {displayIcon() != null && (
        <span {...stylex.props(navItemStyles.iconSlot)}>{displayIcon()}</span>
      )}
      <span {...stylex.props(navItemStyles.label)}>{local.label}</span>
      {endContentNode() != null && (
        <span {...stylex.props(navItemStyles.endContent)}>{endContentNode()}</span>
      )}
      {isRowToggle() && chevron(isExpanded())}
    </>
  );

  const ariaProps = () => ({
    "aria-current": isSelected() ? ("page" as const) : undefined,
    "aria-disabled": isDisabled() || undefined,
    "aria-expanded": isItemCollapsible() ? isExpanded() : undefined,
    "aria-controls": isItemCollapsible() ? `${id}-children` : undefined,
  });

  // 渲染主操作元素：href 且未禁用 → as（动态组件标签）或 <a>；否则 <button>。
  // 注意：不用 <Dynamic component={...}> —— Solid 1.9 的 Dynamic 在 hydration 中渲染
  // 字符串标签（"button"/"a"）会调 getNextElement()（无模板参数），内部 template2()
  // 即 undefined → "template2 is not a function"（见 mobile drawer 报错复现）。
  // 动态组件标签（<Comp>）走 createComponent 组件路径，无此问题。
  const renderElement = (styles: Record<string, unknown>) => {
    if (local.href != null && !isDisabled()) {
      const attrs = { ...elementAttrs(), ...styles };
      if (local.as != null) {
        const Comp = local.as;
        return <Comp {...attrs}>{itemContent()}</Comp>;
      }
      return <a {...attrs}>{itemContent()}</a>;
    }
    return (
      <button
        type="button"
        disabled={isDisabled() || undefined}
        {...elementAttrs()}
        {...styles}
      >
        {itemContent()}
      </button>
    );
  };

  const elementAttrs = () => ({
    ...(rest as Record<string, unknown>),
    ...(local.href != null && !isDisabled() ? { href: local.href } : { disabled: isDisabled() || undefined }),
    onClick: handleClick,
    ...ariaProps(),
    ...toggleMarker(),
  });

  // 外部 class/className 不能走 rest 透传：与内部 stylex 生成的 className 拼接
  const mergeExternalClass = (attrs: Record<string, unknown>) => {
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  // 条目行样式（普通路径）；split-action 路径额外叠加 splitAction 布局
  const itemRowStyles = () =>
    mergeExternalClass(
      stylex.props(
        navItemStyles.item,
        isSize("sm") && navItemStyles.sm,
        isSize("lg") && navItemStyles.lg,
        isSelected() && navItemStyles.selected,
        isDisabled() && navItemStyles.disabled,
        local.xstyle,
      ),
    );
  const splitRowStyles = () =>
    mergeExternalClass(
      stylex.props(
        navItemStyles.splitAction,
        navItemStyles.item,
        isSize("sm") && navItemStyles.sm,
        isSize("lg") && navItemStyles.lg,
        isSelected() && navItemStyles.selected,
        isDisabled() && navItemStyles.disabled,
        local.xstyle,
      ),
    );

  const nestedGroup = () => (
    hasChildren() ? (
      <div
        id={`${id}-children`}
        role="group"
        aria-labelledby={`${id}-label`}
        aria-hidden={isCollapsedState() || undefined}
        {...(isCollapsedState() ? { inert: true } : {})}
        {...stylex.props(
          navItemStyles.children,
          isCollapsedState() && navItemStyles.childrenCollapsed,
        )}
      >
        <div {...stylex.props(navItemStyles.childrenInner)}>
          <span id={`${id}-label`} {...stylex.props(navItemStyles.childrenLabel)}>
            {local.label}
          </span>
          {local.children}
        </div>
      </div>
    ) : null
  );

  // 有独立主操作的可折叠条目：主操作元素 + 独立折叠按钮（split-action 行）
  if (hasIndependentToggle()) {
    return (
      <div {...stylex.props(navItemStyles.itemRoot)}>
        <div {...stylex.props(navItemStyles.splitRow)}>
          {renderElement(splitRowStyles())}
          <button
            type="button"
            data-sidenav-toggle="true"
            onClick={handleToggleClick}
            aria-label={isExpanded() ? t("sideNavItem.collapse", { label: local.label }) : t("sideNavItem.expand", { label: local.label })}
            aria-expanded={isExpanded()}
            aria-controls={`${id}-children`}
            {...stylex.props(navItemStyles.expandToggle)}
          >
            {chevron(isExpanded())}
          </button>
        </div>
        {nestedGroup()}
      </div>
    );
  }

  return (
    <div {...stylex.props(navItemStyles.itemRoot)}>
      {renderElement(itemRowStyles())}
      {nestedGroup()}
    </div>
  );
}

// ============ SideNavSection ============

/**
 * 一级分组：带标题（role="group" + aria-labelledby）的导航条目组。
 */
export function SideNavSection(props: SideNavSectionProps) {
  const titleId = createUniqueId();
  // lazy prop（endContent={<JSX/>}）children() 包装（同 SideNavItem）
  const endContentNode = children(() => props.endContent);
  const headerContent = () => (
    <>
      <span {...stylex.props(sectionStyles.titleContainer)}>
        <span id={titleId} {...stylex.props(sectionStyles.title)}>{props.title}</span>
        {props.subtitle != null && (
          <span {...stylex.props(sectionStyles.subtitle)}>{props.subtitle}</span>
        )}
      </span>
      {endContentNode() != null && (
        <span {...stylex.props(sectionStyles.endContent)}>{endContentNode()}</span>
      )}
    </>
  );
  return (
    <div role="group" aria-labelledby={titleId} {...stylex.props(sectionStyles.root, props.xstyle)}>
      {props.isHeaderHidden ? (
        <span {...stylex.props(sectionStyles.visuallyHidden)}>{headerContent()}</span>
      ) : (
        <div {...stylex.props(sectionStyles.header)}>{headerContent()}</div>
      )}
      <div {...stylex.props(sectionStyles.items)}>{props.children}</div>
    </div>
  );
}

// ============ SideNav ============

/**
 * 纵向导航容器：顶部吸顶（header + topContent）、中间可滚动（children）、
 * 底部吸顶（footer + footerIcons）。
 */
export function SideNav(props: SideNavProps) {
  const { t } = useI18n();
  const hasTop = () => props.header != null || props.topContent != null;
  const hasBottom = () => props.footer != null || props.footerIcons != null;
  return (
    <nav
      role="navigation"
      aria-label={props.label ?? t("mobileNav.navigation")}
      {...stylex.props(navStyles.root, props.xstyle)}
    >
      {hasTop() && (
        <div {...stylex.props(navStyles.stickyTop)}>
          {props.header}
          {props.topContent != null && (
            <div {...stylex.props(navStyles.topContent)}>{props.topContent}</div>
          )}
        </div>
      )}
      <div
        {...stylex.props(
          navStyles.scrollable,
          hasTop() && navStyles.scrollableWithTop,
          hasBottom() && navStyles.scrollableWithBottom,
        )}
      >
        {props.children}
      </div>
      {hasBottom() && (
        <div {...stylex.props(navStyles.stickyBottom)}>
          {props.footer}
          {props.footerIcons != null && (
            <div {...stylex.props(navStyles.footerRow)}>{props.footerIcons}</div>
          )}
        </div>
      )}
    </nav>
  );
}


SideNav.displayName = "SideNav";
SideNavSection.displayName = "SideNavSection";
SideNavItem.displayName = "SideNavItem";