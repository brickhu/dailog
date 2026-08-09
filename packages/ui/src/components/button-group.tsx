import * as stylex from "@stylexjs/stylex";
import { createContext, splitProps, useContext, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { dimensions, shadows } from "../theme.stylex";
import type { ButtonElevation, ButtonSize } from "./button";

/**
 * ButtonGroup（复刻 Astryx ButtonGroup：https://astryx.atmeta.com/components/ButtonGroup）
 * - 多个按钮连接成组：共享边框、圆角只在两端、水平/垂直方向
 * - 子 Button 通过 Context 感知组，位置感知样式纯 CSS 实现（无 wrapper/克隆）
 * - 键盘：方向键在按钮间移动焦点（wrap 循环 + Home/End + 跳过禁用项 + RTL 跟随视觉方向）
 * - 整组禁用（isDisabled）→ 子按钮禁用；elevation 为整组共享阴影（wrapper 带圆角让阴影跟随组外形）
 */

export type ButtonGroupOrientation = "horizontal" | "vertical";

interface ButtonGroupContextValue {
  orientation: () => ButtonGroupOrientation;
  isDisabled: () => boolean;
  size: () => ButtonSize;
}

const ButtonGroupContext = createContext<ButtonGroupContextValue>();

/** Button 检测是否在 ButtonGroup 内；组外返回 undefined。字段为访问器（Solid 中响应式读取） */
export function useButtonGroup(): ButtonGroupContextValue | undefined {
  return useContext(ButtonGroupContext);
}

const styles = stylex.create({
  group: {
    display: "inline-flex",
    alignItems: "stretch",
  },
  vertical: {
    flexDirection: "column",
  },
});

// 整组悬浮阴影：连接按钮共享一个表面，阴影落在组 wrapper 上整体抬起
const elevationStyles = stylex.create({
  low: { boxShadow: shadows.shadowLow },
  med: { boxShadow: shadows.shadowMed },
  high: { boxShadow: shadows.shadowHigh },
});

// 组 elevation 的 wrapper 圆角：跟随组端圆角（阴影随组的圆角外形，而非裸矩形）
const roundStyles = stylex.create({
  sm: { borderRadius: dimensions.radiusSm },
  md: { borderRadius: dimensions.radiusMd },
});

export interface ButtonGroupProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "style" | "class" | "onKeyDown"> {
  /** Button/IconButton 子元素 */
  children: JSX.Element;
  /** 组可访问名（aria-label，必填） */
  label: string;
  /** 布局方向 @default "horizontal" */
  orientation?: ButtonGroupOrientation;
  /** 组内按钮默认尺寸（单个按钮可显式覆盖）@default "md" */
  size?: ButtonSize;
  /** 整组禁用（子按钮全部禁用）@default false */
  isDisabled?: boolean;
  /** 整组悬浮阴影（none 为平面）@default "none" */
  elevation?: ButtonElevation;
  /** StyleX 样式（布局定制，stylex.create 产物） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
  /** 透传原生样式 */
  style?: JSX.CSSProperties;
  onKeyDown?: (e: KeyboardEvent) => void;
}

const SPLIT_KEYS = [
  "label", "orientation", "size", "isDisabled", "elevation", "xstyle",
  "class", "className", "style", "onKeyDown", "children",
] as const;

/** 基础按钮组（两站共享）：复刻 Astryx ButtonGroup —— 连接样式 + 方向键导航 */
export function ButtonGroup(props: ButtonGroupProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  let listEl: HTMLDivElement | undefined;

  const isVertical = () => (local.orientation ?? "horizontal") === "vertical";
  const isElevation = (e: ButtonElevation) => (local.elevation ?? "none") === e && e !== "none";
  const hasElevation = () => isElevation("low") || isElevation("med") || isElevation("high");
  // 组 elevation 的 wrapper 圆角跟随组端圆角（sm 组 4px，其余 8px）
  const groupRound = () => ((local.size ?? "md") === "sm" ? roundStyles.sm : roundStyles.md);

  // Provider value：字段为访问器（Solid context 快照机制下保持响应式）
  const contextValue: ButtonGroupContextValue = {
    orientation: () => local.orientation ?? "horizontal",
    isDisabled: () => !!local.isDisabled,
    size: () => local.size ?? "md",
  };

  // 方向键导航（对齐 Astryx useListFocus 的 ButtonGroup 配置）：
  // 修饰键（Ctrl/Cmd/Alt）不拦截；水平方向键跟随容器视觉方向（RTL，WCAG 1.3.2）；
  // 跳过禁用项（aria-disabled / disabled）；无 roving tabindex——每个按钮独立 Tab 可达
  const handleKeyDown = (e: KeyboardEvent) => {
    local.onKeyDown?.(e);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const horizontal = !isVertical();
    const rtl =
      horizontal && (e.key === "ArrowLeft" || e.key === "ArrowRight")
        ? getComputedStyle(listEl!).direction === "rtl"
        : false;
    let isNext = false;
    let isPrev = false;
    if (horizontal) {
      isNext = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
      isPrev = e.key === (rtl ? "ArrowRight" : "ArrowLeft");
    } else {
      isNext = e.key === "ArrowDown";
      isPrev = e.key === "ArrowUp";
    }
    const isHome = e.key === "Home";
    const isEnd = e.key === "End";
    if (!isNext && !isPrev && !isHome && !isEnd) return;
    const items = Array.from(
      listEl!.querySelectorAll<HTMLElement>("button, [tabindex='0']"),
    ).filter((el) => {
      return !(
        el.getAttribute("aria-disabled") === "true" ||
        (el as HTMLButtonElement).disabled === true ||
        el.hasAttribute("disabled")
      );
    });
    if (items.length === 0) return;
    const active = document.activeElement;
    const current = items.findIndex((el) => el === active || el.contains(active));
    let target: HTMLElement;
    if (isNext) {
      target = current === -1 ? items[0] : items[(current + 1) % items.length];
    } else if (isPrev) {
      target = current === -1 ? items[items.length - 1] : items[(current - 1 + items.length) % items.length];
    } else if (isHome) {
      target = items[0];
    } else {
      target = items[items.length - 1];
    }
    target.focus();
    e.preventDefault();
  };

  // StyleX 条件一律调用表达式（编译约束）
  const stylexAttrs = () =>
    stylex.props(
      styles.group,
      isVertical() && styles.vertical,
      isElevation("low") && elevationStyles.low,
      isElevation("med") && elevationStyles.med,
      isElevation("high") && elevationStyles.high,
      hasElevation() && groupRound(),
      props.xstyle,
    );

  // 外部 class/className 与内部 stylex 类名拼接（不能走 rest 透传，会覆盖 className）
  const mergedAttrs = () => {
    const attrs = stylexAttrs();
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  return (
    <ButtonGroupContext.Provider value={contextValue}>
      <div
        ref={(el) => {
          listEl = el;
        }}
        role="group"
        aria-label={local.label}
        aria-disabled={local.isDisabled || undefined}
        onKeyDown={handleKeyDown}
        style={local.style}
        {...mergedAttrs()}
        {...rest}
      >
        {local.children}
      </div>
    </ButtonGroupContext.Provider>
  );
}
