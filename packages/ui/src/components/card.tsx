import * as stylex from "@stylexjs/stylex";
import { type JSX } from "solid-js";
import { colors, dimensions } from "../theme.stylex";

const styles = stylex.create({
  card: {
    width: "100%",
    boxSizing: "border-box",
    padding: dimensions.spacing8,
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
  },
});

/** 基础卡片容器（两站共享）：surface 底色 + 圆角 + 描边 */
export function Card(props: { children: JSX.Element }) {
  return <div {...stylex.props(styles.card)}>{props.children}</div>;
}
