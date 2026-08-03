import { For } from "solid-js";
import { useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { useAuth } from "../lib/auth";

// 两列布局：左导航（节目/设置）+ 右侧内容区（子路由经 props.children 渲染）
const NAV = [
  { path: "/app/episodes", label: "节目" },
  { path: "/app/settings", label: "设置" },
];

const styles = stylex.create({
  shell: {
    display: "flex",
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
  },
  sidebar: {
    width: "220px",
    flexShrink: 0,
    borderRight: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorSurface,
    display: "flex",
    flexDirection: "column",
    position: "sticky",
    top: 0,
    height: "100vh",
  },
  brand: {
    padding: `${tokens.space4} ${tokens.space4}`,
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorPrimary,
    cursor: "pointer",
  },
  nav: {
    flex: 1,
    padding: `${tokens.space2} ${tokens.space3}`,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1,
  },
  link: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: "transparent",
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  linkActive: {
    background: "rgba(91, 140, 255, 0.12)",
    color: tokens.colorPrimary,
  },
  footer: {
    padding: tokens.space3,
    borderTop: `1px solid ${tokens.colorBorder}`,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2,
  },
  email: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  signOut: {
    background: "transparent",
    border: "none",
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeSm,
    textAlign: "left",
    padding: 0,
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
});

export default function AppLayout(props: RouteSectionProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div {...stylex.props(styles.shell)}>
      <aside {...stylex.props(styles.sidebar)}>
        <div {...stylex.props(styles.brand)} onClick={() => navigate("/app/episodes")}>
          dailogues
        </div>
        <nav {...stylex.props(styles.nav)}>
          <For each={NAV}>
            {(item) => (
              <button
                {...stylex.props(styles.link, location.pathname.startsWith(item.path) && styles.linkActive)}
                onClick={() => navigate(item.path)}
              >
                {item.label}
              </button>
            )}
          </For>
        </nav>
        <div {...stylex.props(styles.footer)}>
          <span {...stylex.props(styles.email)}>{auth.user?.email}</span>
          <button {...stylex.props(styles.signOut)} onClick={() => auth.signOut()}>
            退出登录
          </button>
        </div>
      </aside>
      <main {...stylex.props(styles.main)}>{props.children}</main>
    </div>
  );
}
