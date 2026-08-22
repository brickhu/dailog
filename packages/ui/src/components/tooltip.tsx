import * as stylex from "@stylexjs/stylex";
import { Show } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, fontfamilies } from "../theme.stylex";

/**
 * 统一自绘 Tooltip（两站共享，Button / TextInput / Slider 等组件内部全部经此渲染）：
 * - 底色 colors.foreground、字色 colors.background（主题反色面对：亮色=深底浅字，暗色=浅底深字）；
 *   外部可经 --tooltip-bg / --tooltip-text 覆盖（变量作用于气泡或任意祖先，经继承生效）
 * - 位置：placement 控制（top 上方居中 / bottom 下方左对齐 / end 侧边 inline-end 居中），
 *   锚点需 position: relative（气泡 absolute 定位）
 * - 显隐由调用方控制（isOpen + hover/focus 信号），本组件只负责渲染气泡内容
 */

// 颜色：统一 foreground 底 / background 字（反色面对），可经 CSS 变量覆盖（fallback 取主题 token）
const TOOLTIP_BG = "var(--tooltip-bg, " + colors.foreground + ")";
const TOOLTIP_TEXT = "var(--tooltip-text, " + colors.background + ")";

const tooltipIn = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

export const tooltipStyles = stylex.create({
  tooltip: {
    position: "absolute",
    bottom: "calc(100% + 6px)",
    left: "50%",
    transform: "translateX(-50%)",
    backgroundColor: TOOLTIP_BG,
    color: TOOLTIP_TEXT,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightNormal,
    lineHeight: "1.5",
    padding: dimensions.spacing1 + " " + dimensions.spacing2,
    borderRadius: dimensions.radiusSm,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: 10,
    animationName: tooltipIn,
    animationDuration: durations.durationFast,
    animationFillMode: "backwards",
    animationDelay: {
      default: "80ms",
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  // 锚点下方（左对齐，用于说明/信息气泡）
  bottom: {
    top: "calc(100% + 6px)",
    bottom: "auto",
    left: 0,
    transform: "none",
  },
  // 锚点侧边（inline-end 居中，垂直滑块等竖向场景）
  end: {
    bottom: "auto",
    top: "50%",
    left: "auto",
    insetInlineEnd: "calc(100% + 8px)",
    transform: "translateY(-50%)",
  },
});

export type TooltipPlacement = "top" | "bottom" | "end";

export interface TooltipProps {
  /** 提示内容；undefined 时整体不渲染 */
  label?: string;
  /** 显示开关（hover/focus 等由锚点组件控制） */
  isOpen: boolean;
  /** 关联 id（供锚点 aria-describedby 指向） */
  id?: string;
  /** 位置：top 上方居中（默认）/ bottom 下方左对齐 / end 侧边（inline-end）居中 */
  placement?: TooltipPlacement;
  /** 外部样式注入（作用于气泡外层，如 maxWidth/阴影/换行） */
  xstyle?: StyleXStyles;
}

/** 统一自绘 tooltip（锚点需 position: relative；气泡绝对定位于锚点上方/下方/侧边） */
export function Tooltip(props: TooltipProps) {
  // stylex.props 条件须为裸调用表达式（同 button.tsx 约定）：二元表达式会被编译期求值
  const isPlacement = (p: TooltipPlacement) => (props.placement ?? "top") === p;
  return (
    <Show when={props.isOpen && props.label != null}>
      <span
        id={props.id}
        role="tooltip"
        {...stylex.props(
          tooltipStyles.tooltip,
          isPlacement("bottom") && tooltipStyles.bottom,
          isPlacement("end") && tooltipStyles.end,
          props.xstyle,
        )}
      >
        {props.label}
      </span>
    </Show>
  );
}
