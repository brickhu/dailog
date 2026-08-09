import { Button } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useNavigate } from "@solidjs/router";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing3,
    backgroundColor: colors.background,
    color: colors.neutral,
  },
  code: {
    fontSize: "48px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.ink,
  },
});

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.code)}>404</div>
      <div>页面不存在</div>
<Button onClick={() => navigate("/episodes")}>回工作台</Button>
    </div>
  );
}
