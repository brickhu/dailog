import { render } from "solid-js/web";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "./theme.stylex.ts";

const styles = stylex.create({
  root: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  card: {
    padding: tokens.space6,
    borderRadius: tokens.radiusLg,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    textAlign: "center",
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorPrimary,
    marginBottom: tokens.space2,
  },
  tag: {
    display: "inline-block",
    marginTop: tokens.space3,
    padding: `${tokens.space1} ${tokens.space3}`,
    borderRadius: tokens.radiusFull,
    background: tokens.colorPrimary,
    color: "#fff",
    fontSize: tokens.fontSizeSm,
  },
});

function App() {
  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.title)}>dailogues 工作台</div>
        <div>StyleX + SolidJS 脚手架验证</div>
        <div {...stylex.props(styles.tag)}>token 生效 ✓</div>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
