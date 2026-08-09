import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "../theme.stylex";

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  base: {
    display: "inline-block",
    borderStyle: "solid",
    borderRadius: dimensions.radiusFull,
    animationName: spin,
    animationDuration: "0.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  // 尺寸：数字按 px 处理（StyleX 函数样式）
  size: (px: number) => ({ width: `${px}px`, height: `${px}px`, borderWidth: "2px" }),
  shadeDefault: {
    borderColor: colors.ink,
    borderTopColor: colors.primary,
  },
  // 按钮内加载用：颜色继承所在元素的文本色（primary 蓝底上是白环）
  shadeInherit: {
    borderColor: "color-mix(in srgb, currentColor 30%, transparent)",
    borderTopColor: "currentColor",
  },
});

/** 加载指示器（两站共享）：旋转圆环。size 默认 20px；shade="inherit" 时颜色跟随文本色 */
export function Spinner(props: { size?: number; shade?: "default" | "inherit" } = {}) {
  return (
    <div
      {...stylex.props(
        styles.base,
        styles.size(props.size ?? 20),
        props.shade === "inherit" ? styles.shadeInherit : styles.shadeDefault,
      )}
    />
  );
}
