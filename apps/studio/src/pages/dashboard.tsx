import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    color: tokens.colorTextMuted,
  },
});

export default function Dashboard() {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.placeholder)}>工作台建设中（Task 5）</div>
    </div>
  );
}
