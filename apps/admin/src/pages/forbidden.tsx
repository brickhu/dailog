import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { useAuth } from "../lib/auth";

// 403 页面：普通用户（非 admin/editor）登录工作台时统一展示
// 带登出按钮——否则无权限用户会卡死在此页

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing4,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: dimensions.spacing8,
    textAlign: "center",
  },
  code: {
    fontSize: "64px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.neutral,
    lineHeight: 1,
    margin: 0,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    maxWidth: "420px",
    margin: 0,
    lineHeight: 1.6,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing2,
  },
  homeLink: {
    textDecoration: "none",
    color: "inherit",
  },
});

export default function ForbiddenPage() {
  const { t } = useI18n();
  const auth = useAuth();

  return (
    <div {...stylex.props(styles.page)}>
      <p {...stylex.props(styles.code)}>403</p>
      <h1 {...stylex.props(styles.title)}>{t("admin.denied")}</h1>
      <p {...stylex.props(styles.desc)}>{t("admin.deniedDesc")}</p>
      <div {...stylex.props(styles.actions)}>
        <a href="/" {...stylex.props(styles.homeLink)}>
          <Button appear="outline">{t("nav.home")}</Button>
        </a>
        <Button onClick={() => auth.signOut()}>{t("nav.logout")}</Button>
      </div>
    </div>
  );
}
