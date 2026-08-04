import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

const styles = stylex.create({
  spinner: {
    display: "inline-block",
    width: "20px",
    height: "20px",
    border: `2px solid ${tokens.colorBorder}`,
    borderTopColor: tokens.colorPrimary,
    borderRadius: tokens.radiusFull,
    animation: "dailog-spin 0.8s linear infinite",
  },
});

/** 加载指示器（两站共享）：旋转圆环 */
export function Spinner() {
  return <div {...stylex.props(styles.spinner)} />;
}
