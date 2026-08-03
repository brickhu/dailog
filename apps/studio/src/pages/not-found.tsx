import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { useNavigate } from "@solidjs/router";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space3,
    background: tokens.colorBg,
    color: tokens.colorTextMuted,
  },
  code: {
    fontSize: "48px",
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorBorder,
  },
  button: {
    padding: `${tokens.space2} ${tokens.space4}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
  },
});

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.code)}>404</div>
      <div>页面不存在</div>
      <button {...stylex.props(styles.button)} onClick={() => navigate("/dashboard")}>
        回工作台
      </button>
    </div>
  );
}
