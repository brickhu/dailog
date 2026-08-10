import { createSignal, For, Show } from "solid-js";
import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useAuth } from "../lib/auth";
import { useI18n } from "@dailogues/i18n";
import { env } from "../lib/env";

// 两列布局：左导航（节目/设置）+ 右侧内容区（子路由经 props.children 渲染）
const NAV = [
  { path: "/", label: "nav.import" },
  { path: "/polishes", label: "nav.scripts" },
  { path: "/episodes", label: "nav.episodes" },
  { path: "/settings", label: "nav.settings" },
];

const styles = stylex.create({
  shell: {
    display: "flex",
    minHeight: "100vh",
  },
  sidebar: {
    width: "220px",
    flexShrink: 0,
    borderRight: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    position: "sticky",
    top: 0,
    height: "100vh",
  },
  brand: {
    padding: `${dimensions.spacing4} ${dimensions.spacing4}`,
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    color: colors.primary,
    cursor: "pointer",
    textDecoration: "none",
  },
  nav: {
    flex: 1,
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
  },
  link: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: "none",
    backgroundColor: "transparent",
    color: colors.neutral,
    cursor: "pointer",
    fontSize: dimensions.fontSizeMd,
  },
  linkActive: {
    backgroundColor: "rgba(91, 140, 255, 0.12)",
    color: colors.primary,
  },
  footer: {
    padding: dimensions.spacing3,
    borderTop: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  email: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  signOut: {
    background: "transparent",
    border: "none",
    color: colors.neutral,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    textAlign: "left",
    padding: 0,
  },
  accountLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.foreground },
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  verifyBanner: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing2} ${dimensions.spacing4}`,
    backgroundColor: "rgba(240, 173, 78, 0.12)",
    borderBottom: `1px solid rgba(240, 173, 78, 0.35)`,
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
  },
  verifyText: {
    flex: 1,
  },
  resendBtn: {
    background: "transparent",
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    color: colors.foreground,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
  },
  resendMsg: {
    color: colors.danger,
  },
  resendMsgOk: {
    color: colors.primary,
  },
});

export default function AppLayout(props: RouteSectionProps) {
  const { t, locale, setLocale } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [resending, setResending] = createSignal(false);
  const [resendMsg, setResendMsg] = createSignal<{ ok: boolean; text: string } | null>(null);

  const resendVerification = async () => {
    setResending(true);
    setResendMsg(null);
    const { error } = await auth.resendVerification();
    setResendMsg(error ? { ok: false, text: error } : { ok: true, text: t("layout.resendSent") });
    setResending(false);
  };

  return (
    <div {...stylex.props(styles.shell)}>
      <aside {...stylex.props(styles.sidebar)}>
        <a href={env.siteBaseUrl} target="_blank" rel="noopener" {...stylex.props(styles.brand)}>
          dailog
        </a>
        <nav {...stylex.props(styles.nav)}>
          <For each={NAV}>
            {(item) => (
              <button
                {...stylex.props(styles.link, (item.path === "/" ? location.pathname === "/" || location.pathname === "/import" : location.pathname.startsWith(item.path)) && styles.linkActive)}
                onClick={() => navigate(item.path)}
              >
                {t(item.label as never)}
              </button>
            )}
          </For>
        </nav>
        <div {...stylex.props(styles.footer)}>
          <span {...stylex.props(styles.email)}>{auth.user?.email}</span>
          <Show when={env.siteBaseUrl}>
            <a href={`${env.siteBaseUrl}/account`} target="_blank" rel="noopener" {...stylex.props(styles.accountLink)}>
              账号管理
            </a>
          </Show>
          <button {...stylex.props(styles.signOut)} onClick={() => setLocale(locale() === "zh" ? "en" : "zh")}>
            {locale() === "zh" ? "EN" : "中文"}
          </button>
          <button {...stylex.props(styles.signOut)} onClick={() => auth.signOut()}>
            {t("nav.logout")}
          </button>
        </div>
      </aside>
      <main {...stylex.props(styles.main)}>
        <Show when={auth.user && !auth.user.emailVerified}>
          <div {...stylex.props(styles.verifyBanner)}>
            <span {...stylex.props(styles.verifyText)}>
              邮箱尚未验证，请查收验证邮件；未收到可重新发送。
            </span>
            <button {...stylex.props(styles.resendBtn)} disabled={resending()} onClick={resendVerification}>
              {resending() ? t("layout.sending") : t("layout.resend")}
            </button>
            <Show when={resendMsg()}>
              <span {...stylex.props(styles.resendMsg, resendMsg()!.ok && styles.resendMsgOk)}>
                {resendMsg()!.text}
              </span>
            </Show>
          </div>
        </Show>
        {props.children}
      </main>
    </div>
  );
}
