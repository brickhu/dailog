import * as stylex from "@stylexjs/stylex";
import { createSignal, createUniqueId, splitProps, Show, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { Icon } from "./icon";
import { colors, dimensions, durations, easings, shadows } from "../theme.stylex";
import { Button } from "./button";

/**
 * Banner（复刻 Astryx Banner：https://astryx.atmeta.com/components/Banner，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 常驻状态横幅：info/success → role="status"（轮询播报），warning/error → role="alert"（立即打断）
 * - 自管理 dismissed：点关闭后淡出（150ms opacity）再卸载，onDismiss 仅为通知回调（无需外部状态）；
 *   挂载时淡入（keyframes 播放一次 + backwards fill，动画结束后不影响关闭淡出的过渡）
 * - 有 children 时头部出现 chevron 开关（disclosure 模式：aria-expanded + aria-controls，
 *   aria-controls 仅在内容区挂载时引用，避免悬空 id）；内容区为卡片底 + 三边描边，
 *   展开/收起带 grid-template-rows 高度动画（durationMediumMin + easeInOut + 透明度），
 *   收起动画结束后才卸载（避免 DOM 残留 0 高、仍可聚焦的内容）
 * - container="card"：独立圆角（内容区展开时头部只保留顶部圆角，阴影跟随轮廓）；
 *   "section"：全宽无圆角，用于页面级横幅
 * - 状态图标 absolute 于头部左上角、端区按钮 absolute 于右上角：均向内伸入
 *   padding 区 4px（calc(spacing4 - spacing1)，不越过容器边缘）；文本区在两者之间，
 *   左端补图标间距、右端按按钮数预留宽度
 * - 无描述且有操作时内容垂直居中；标题/描述用 <div>（<p> 不能合法包含块级子元素，
 *   用 div 保证任意内容可组合）
 * - 状态色全部映射 theme.stylex tokens：底=secondaryWeak/warningWeak/dangerWeak/successWeak，
 *   文字与图标=on{status}Weak；内容区=surface 底 + ink 15% 半透明描边；
 *   chevron 动画=durationFast + easeOut，尊重 prefers-reduced-motion
 * - 图标用项目已有的 @iconify-icon/solid（mdi 系列）；展开/关闭按钮复用项目 Button
 *   （neutral/ghost/sm/isIconOnly + tooltip），颜色随横幅文字（on{status}Weak，
 *   xstyle 覆盖内部 ghost 色；hover 底色为同色 12% 半透明 tint）
 */

export type BannerStatus = "info" | "warning" | "error" | "success";
/** 容器形态：card 带圆角；section 全宽无圆角（页面级横幅） */
export type BannerContainer = "card" | "section";
/** 悬浮阴影层级（shadows token 档位） */
export type BannerElevation = "none" | "low" | "med" | "high";

export interface BannerProps
  extends Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    "title" | "style" | "class" | "className" | "children"
  > {
  /** 状态：控制图标、配色与 ARIA role（info/success→status，warning/error→alert） */
  status: BannerStatus;
  /** 标题（<div> 渲染，可传任意内容） */
  title: JSX.Element;
  /** 描述（标题下方） */
  description?: JSX.Element;
  /** 覆盖默认状态图标（原样透传，不染色） */
  icon?: JSX.Element;
  /** 显示关闭按钮；自管理隐藏，无需外部状态 @default false */
  isDismissable?: boolean;
  /** 关闭回调（无论是否提供，横幅都会自行隐藏） */
  onDismiss?: () => void;
  /** 头部末端操作区（如操作按钮） */
  endContent?: JSX.Element;
  /** 容器形态 @default "card" */
  container?: BannerContainer;
  /** 悬浮阴影（card 形态阴影跟随圆角）@default "none" */
  elevation?: BannerElevation;
  /** children 初始是否展开 @default false */
  defaultIsExpanded?: boolean;
  /** 折叠内容区（提供后头部出现展开/收起开关） */
  children?: JSX.Element;
  /** 外部注入 StyleX 样式（最后合并，冲突时覆盖内部） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
  /** 透传内联样式 */
  style?: JSX.CSSProperties;
}

// 内容区分隔描边色：ink 15% 半透明（与 button-group 分隔边框同一手法）
const CONTENT_BORDER = `color-mix(in srgb, ${colors.ink} 15%, transparent)`;

// 挂载淡入（播放一次；backwards fill：结束后回到常规样式，不干扰关闭淡出的过渡）
const fadeIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const styles = stylex.create({
  // Root：仅布局，无视觉样式（阴影/圆角按需叠加）。
  // 用 block 而非 flex column：flex 容器交叉轴尺寸为不定值（fit-content，由最宽子项
  // 决定）时 align-items: stretch 不生效（规范：cross size 不明确时不拉伸），grid 子项
  // 会缩成自身 max-content 导致内容区与头部不等宽；block 子元素天然撑满容器宽度
  root: {
    display: "block",
    fontFamily: "inherit",
    // 挂载淡入（keyframes 播放一次）
    animationName: fadeIn,
    animationDuration: {
      default: durations.durationMediumMin,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationFillMode: "backwards",
    animationTimingFunction: easings.easeInOut,
    // 关闭淡出：opacity 过渡结束后才卸载（见 handleRootTransitionEnd）
    transitionProperty: "opacity",
    transitionDuration: {
      default: durations.durationMediumMin,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: easings.easeInOut,
  },
  // 关闭淡出终态（isClosing 时应用）
  rootClosing: {
    opacity: 0,
  },
  // 悬浮时 card 容器圆角 root，阴影跟随头部/内容区同轮廓
  rootElevatedCard: {
    borderRadius: dimensions.radiusLg,
  },
  // 头部：状态色底 + 图标 + 标题/描述 + 操作 + 开关 + 关闭
  // position: relative——作为图标（左上）与端区（右上）absolute 的定位上下文
  header: {
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: dimensions.spacing2,
    paddingBlock: dimensions.spacing3,
    paddingInline: dimensions.spacing4,
  },
  // card 容器圆角：独立时四角全圆；内容区展开时只保留顶部
  headerCardStandalone: { borderRadius: dimensions.radiusLg },
  headerCardWithContent: {
    borderStartStartRadius: dimensions.radiusLg,
    borderStartEndRadius: dimensions.radiusLg,
    borderEndStartRadius: 0,
    borderEndEndRadius: 0,
  },
  // 仅有标题（无描述）且带操作时垂直居中
  headerCentered: { alignItems: "center" },
  // 文本区：flex:1 占满头部；左端补图标出流后的间距，右端按端区按钮数预留
  // 左端：图标右缘 12+20=32px + 8px 间隙 → 距边 40px（content box 16px 起 → 补 24px）
  // 右端：按钮距边 12px（spacing4-spacing1），单按钮 24px → 24+8-4=28px；
  //       双按钮 48+8+8-4=60px（均为 paddingInlineEnd）
  headerContent: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    flex: 1,
    minWidth: 0,
    paddingInlineStart: `calc(${dimensions.spacing4} + ${dimensions.spacing2})`,
  },
  reserveEndOne: {
    paddingInlineEnd: `calc(${dimensions.sizeSm} + ${dimensions.spacing2} - ${dimensions.spacing1})`,
  },
  reserveEndTwo: {
    paddingInlineEnd: `calc(${dimensions.sizeSm} * 2 + ${dimensions.spacing2} * 2 - ${dimensions.spacing1})`,
  },
  title: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightSemiBold,
    lineHeight: "1.5",
  },
  description: {
    margin: 0,
    fontFamily: "inherit",
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
  },
  // 状态图标：absolute 于头部左上角，左缘伸入 padding 区 4px（calc(spacing4 - spacing1)，
  // 不越过容器边缘）；top 对齐文本顶端
  iconWrapper: {
    position: "absolute",
    top: dimensions.spacing3,
    left: `calc(${dimensions.spacing4} - ${dimensions.spacing1})`,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  // 末端区：操作 + 展开开关 + 关闭；absolute 于头部右上角，右缘伸入 padding 区 4px
  // （calc(spacing4 - spacing1)，与左侧图标对称）
  endArea: {
    position: "absolute",
    top: dimensions.spacing2,
    right: `calc(${dimensions.spacing4} - ${dimensions.spacing1})`,
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    flexShrink: 0,
  },
  // 内容区：卡片底 + 三边描边（顶部由头部底色承接）
  contentArea: {
    backgroundColor: colors.surface,
    paddingBlock: dimensions.spacing3,
    paddingInline: dimensions.spacing4,
    borderInlineStartWidth: dimensions.borderWidthThin,
    borderInlineEndWidth: dimensions.borderWidthThin,
    borderBottomWidth: dimensions.borderWidthThin,
    borderInlineStartStyle: "solid",
    borderInlineEndStyle: "solid",
    borderBottomStyle: "solid",
    borderInlineStartColor: CONTENT_BORDER,
    borderInlineEndColor: CONTENT_BORDER,
    borderBottomColor: CONTENT_BORDER,
  },
  contentAreaCard: {
    borderEndStartRadius: dimensions.radiusLg,
    borderEndEndRadius: dimensions.radiusLg,
  },
  // 内容区折叠动画：grid-template-rows 0fr↔1fr + 透明度（纯 CSS，无需 JS 测高；
  // reduced-motion 下 0s 直接切换）
  // 注意 gridTemplateColumns: "1fr" 不能省——只定义 rows 时隐式列为 auto（按内容
  // 宽），内容区会缩成 children 的宽度而非与 banner 等宽
  contentCollapse: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gridTemplateRows: "0fr",
    opacity: 0,
    transitionProperty: "grid-template-rows, opacity",
    transitionDuration: {
      default: durations.durationMediumMin,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: easings.easeInOut,
  },
  contentCollapseOpen: {
    gridTemplateRows: "1fr",
    opacity: 1,
  },
  // grid 子项：min-height 0 + overflow hidden 才能被压到 0 高；
  // width 100%：实测 justify-self stretch 在该元素上不生效（样式经 stylex 原子类
  // 注入 + grid 过渡时），用百分比宽度按 grid 区域解析，保证与 banner 等宽
  contentClip: {
    overflow: "hidden",
    minHeight: 0,
    width: "100%",
  },
  chevron: {
    display: "inline-flex",
    transitionProperty: "transform",
    transitionDuration: {
      default: durations.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: easings.easeOut,
  },
  chevronExpanded: { transform: "rotate(180deg)" },
});

// 状态底（Astryx muted 底 → 项目 *Weak 档）
const statusStyles = stylex.create({
  info: { backgroundColor: colors.secondaryWeak },
  warning: { backgroundColor: colors.warningWeak },
  error: { backgroundColor: colors.dangerWeak },
  success: { backgroundColor: colors.successWeak },
});

// 状态文字/图标色（各状态底色的对比色，保证可读性）
const statusTextStyles = stylex.create({
  info: { color: colors.onSecondaryWeak },
  warning: { color: colors.onWarningWeak },
  error: { color: colors.onDangerWeak },
  success: { color: colors.onSuccessWeak },
});

// 端区按钮（展开/关闭）文字/图标与横幅文字同色（on{status}Weak），hover 底色用
// 同色 12% 半透明 tint；hover 选择器与 Button ghost 内部完全一致
// （:hover:not(:disabled):not([aria-disabled]) + @media (hover: hover)），
// 同特异度靠样式表先后（banner 晚于 button 编译）覆盖内部 hover——即 button.md
// 中 xstyle「同名属性覆盖内部」的既有约定
const actionButtonStyles = stylex.create({
  info: {
    color: colors.onSecondaryWeak,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": {
        color: colors.onSecondaryWeak,
        backgroundColor: `color-mix(in srgb, ${colors.onSecondaryWeak} 12%, transparent)`,
      },
    },
  },
  warning: {
    color: colors.onWarningWeak,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": {
        color: colors.onWarningWeak,
        backgroundColor: `color-mix(in srgb, ${colors.onWarningWeak} 12%, transparent)`,
      },
    },
  },
  error: {
    color: colors.onDangerWeak,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": {
        color: colors.onDangerWeak,
        backgroundColor: `color-mix(in srgb, ${colors.onDangerWeak} 12%, transparent)`,
      },
    },
  },
  success: {
    color: colors.onSuccessWeak,
    ":hover:not(:disabled):not([aria-disabled])": {
      "@media (hover: hover)": {
        color: colors.onSuccessWeak,
        backgroundColor: `color-mix(in srgb, ${colors.onSuccessWeak} 12%, transparent)`,
      },
    },
  },
});

// 阴影层级
const elevationStyles = stylex.create({
  none: { boxShadow: "none" },
  low: { boxShadow: shadows.shadowLow },
  med: { boxShadow: shadows.shadowMed },
  high: { boxShadow: shadows.shadowHigh },
});

// 状态 → 默认图标（@iconify-icon/solid，mdi 系列）
const defaultIcons: Record<BannerStatus, string> = {
  info: "mdi:information-outline",
  success: "mdi:check-circle",
  warning: "mdi:alert",
  error: "mdi:alert-circle",
};

// 状态 → ARIA role：info/success 轮询播报，warning/error 立即打断
const statusRole: Record<BannerStatus, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "alert",
  error: "alert",
};

const SPLIT_KEYS = [
  "status", "title", "description", "icon", "isDismissable", "onDismiss", "endContent",
  "container", "elevation", "defaultIsExpanded", "children", "xstyle", "style",
  "class", "className",
] as const;

/** 常驻状态横幅（两站共享）：复刻 Astryx Banner 行为；status 语义色 × container 形态 × elevation 阴影 */
export function Banner(props: BannerProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 自管理关闭/展开状态（均为非受控，与参考实现一致）
  const [isDismissed, setIsDismissed] = createSignal(false);
  // 关闭淡出动画中（transitionend 后才真正卸载）
  const [isClosing, setIsClosing] = createSignal(false);
  const [isExpanded, setIsExpanded] = createSignal(props.defaultIsExpanded ?? false);
  // 内容区挂载与进入动画：展开时先挂载（0fr 起始帧），下一帧再翻转 rows 触发高度动画；
  // 收起动画结束后卸载（避免 DOM 残留 0 高、仍可聚焦的内容）
  const [isRendered, setIsRendered] = createSignal(
    props.children != null && (props.defaultIsExpanded ?? false),
  );
  const [entering, setEntering] = createSignal(props.defaultIsExpanded ?? false);
  // 关联展开开关与内容区（disclosure 模式；仅挂载时引用避免悬空 id）
  const contentId = createUniqueId();

  // StyleX 限制：stylex.props 条件必须是调用表达式或直接引用 props——
  // 取值判断统一包成函数（逻辑/一元表达式在编译期静态求值时炸 Unsupported expression）
  const isStatus = (s: BannerStatus) => props.status === s;
  const isCard = () => (props.container ?? "card") === "card";
  const isElevation = (e: BannerElevation) => (props.elevation ?? "none") === e;
  const isElevated = () => (props.elevation ?? "none") !== "none";
  const hasChildren = () => props.children != null;
  const hasActions = () => props.endContent != null || !!props.isDismissable;
  const showEndArea = () => props.endContent != null || !!props.isDismissable || hasChildren();
  const isSingleLine = () => props.description == null && hasActions();
  const showContent = () => hasChildren() && isExpanded();
  // 内容区展开动画态：挂载后下一帧才置 true（0fr→1fr 过渡的起点）
  const contentOpen = () => isExpanded() && entering();
  // 文本右端预留：端区 absolute 后不占流内空间，按端区条目数预留按钮宽度
  // （endContent 宽度未知，按一个 sm 按钮近似）
  const reserveEnd = () => {
    if (!showEndArea()) return undefined;
    const slots =
      (props.endContent != null ? 1 : 0) + (hasChildren() ? 1 : 0) + (props.isDismissable ? 1 : 0);
    return slots >= 2 ? styles.reserveEndTwo : styles.reserveEndOne;
  };
  const elevatedCard = () => isCard() && isElevated();
  // 头部圆角跟随形态与内容区展开态：card 独立时四角全圆，展开时只留顶部
  const headerRadius = () =>
    isCard()
      ? showContent()
        ? styles.headerCardWithContent
        : styles.headerCardStandalone
      : undefined;

  // 尊重 prefers-reduced-motion：0s 过渡可能不派发 transitionend，需直接切换终态
  const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const handleDismiss = () => {
    // 淡出动画结束后卸载（reduced-motion 下无过渡事件，直接卸载）
    setIsClosing(true);
    local.onDismiss?.();
    if (prefersReducedMotion()) setIsDismissed(true);
  };
  // 仅响应根元素自身的 opacity 过渡结束（transitionend 会从子元素冒泡）
  const handleRootTransitionEnd = (e: TransitionEvent) => {
    if (e.target !== e.currentTarget || e.propertyName !== "opacity") return;
    if (isClosing()) setIsDismissed(true);
  };
  const handleToggleExpand = () => {
    if (isExpanded()) {
      // 收起：播放 1fr→0fr 动画，结束后卸载（reduced-motion / 尚未展开则立即卸载）
      setIsExpanded(false);
      if (prefersReducedMotion() || !entering()) setIsRendered(false);
    } else {
      // 展开：先挂载（0fr 起始帧），下一帧翻转 rows 触发高度动画
      setIsExpanded(true);
      setIsRendered(true);
      setEntering(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntering(true));
      });
    }
  };
  // 仅响应内容区自身的 rows 过渡结束（transitionend 会从子元素冒泡、opacity 同刻结束）
  const handleContentTransitionEnd = (e: TransitionEvent) => {
    if (e.target !== e.currentTarget || e.propertyName !== "grid-template-rows") return;
    if (!isExpanded()) setIsRendered(false);
  };

  // 外部 class/className 显式拼接（同 button.tsx：后 spread 的 class 会整体覆盖内部 stylex 类名）
  const mergedAttrs = () => {
    const attrs = stylex.props(
      styles.root,
      isClosing() && styles.rootClosing,
      elevatedCard() && styles.rootElevatedCard,
      isElevation("low") && elevationStyles.low,
      isElevation("med") && elevationStyles.med,
      isElevation("high") && elevationStyles.high,
      props.xstyle,
    );
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  return (
    <Show when={!isDismissed()} fallback={null}>
      <div
        role={statusRole[props.status]}
        style={local.style}
        onTransitionEnd={handleRootTransitionEnd}
        {...mergedAttrs()}
        {...rest}
      >
        {/* 头部：状态色底（图标 + 标题/描述 + 操作 + 开关 + 关闭） */}
        <div
          {...stylex.props(
            styles.header,
            isSingleLine() && styles.headerCentered,
            isStatus("info") && statusStyles.info,
            isStatus("warning") && statusStyles.warning,
            isStatus("error") && statusStyles.error,
            isStatus("success") && statusStyles.success,
            headerRadius(),
          )}
        >
          <div
            {...stylex.props(
              styles.iconWrapper,
              isStatus("info") && statusTextStyles.info,
              isStatus("warning") && statusTextStyles.warning,
              isStatus("error") && statusTextStyles.error,
              isStatus("success") && statusTextStyles.success,
            )}
            aria-hidden="true"
          >
            {local.icon ?? <Icon icon={defaultIcons[props.status]} width={20} height={20} />}
          </div>
          <div {...stylex.props(styles.headerContent, reserveEnd())}>
            <div
              {...stylex.props(
                styles.title,
                isStatus("info") && statusTextStyles.info,
                isStatus("warning") && statusTextStyles.warning,
                isStatus("error") && statusTextStyles.error,
                isStatus("success") && statusTextStyles.success,
              )}
            >
              {local.title}
            </div>
            <Show when={local.description != null}>
              <div
                {...stylex.props(
                  styles.description,
                  isStatus("info") && statusTextStyles.info,
                  isStatus("warning") && statusTextStyles.warning,
                  isStatus("error") && statusTextStyles.error,
                  isStatus("success") && statusTextStyles.success,
                )}
              >
                {local.description}
              </div>
            </Show>
          </div>
          <Show when={showEndArea()}>
            <div {...stylex.props(styles.endArea)}>
              {local.endContent}
              <Show when={hasChildren()}>
                <Button
                  variant="neutral"
                  appear="ghost"
                  size="sm"
                  isIconOnly
                  xstyle={actionButtonStyles[props.status]}
                  label={isExpanded() ? "Collapse" : "Expand"}
                  tooltip={isExpanded() ? "Collapse" : "Expand"}
                  icon={
                    <span
                      {...stylex.props(
                        styles.chevron,
                        isExpanded() && styles.chevronExpanded,
                      )}
                    >
                      <Icon icon="mdi:chevron-down" width={16} height={16} />
                    </span>
                  }
                  onClick={handleToggleExpand}
                  aria-expanded={isExpanded()}
                  aria-controls={isRendered() ? contentId : undefined}
                />
              </Show>
              <Show when={local.isDismissable}>
                <Button
                  variant="neutral"
                  appear="ghost"
                  size="sm"
                  isIconOnly
                  xstyle={actionButtonStyles[props.status]}
                  label="Dismiss"
                  tooltip="Dismiss"
                  icon={<Icon icon="mdi:close" width={16} height={16} />}
                  onClick={handleDismiss}
                />
              </Show>
            </div>
          </Show>
        </div>
        {/* 内容区：可折叠卡片底（grid-template-rows 0fr↔1fr 高度动画 + 透明度） */}
        <Show when={isRendered()}>
          <div
            id={contentId}
            onTransitionEnd={handleContentTransitionEnd}
            {...stylex.props(
              styles.contentCollapse,
              contentOpen() && styles.contentCollapseOpen,
            )}
          >
            <div {...stylex.props(styles.contentClip)}>
              <div
                {...stylex.props(styles.contentArea, isCard() && styles.contentAreaCard)}
              >
                {local.children}
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
