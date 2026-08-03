import { For } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { useAuth } from "../lib/auth";

const LINKS = [
  { path: "/dashboard", label: "我的节目" },
  { path: "/episodes/new", label: "新建节目" },
  { path: "/settings", label: "设置" },
];

const styles = stylex.create({
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: `${tokens.space3} ${tokens.space6}`,
    borderBottom: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorSurface,
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space5,
  },
  brand: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorPrimary,
    cursor: "pointer",
  },
  nav: {
    display: "flex",
    gap: tokens.space4,
  },
  link: {
    background: "transparent",
    border: "none",
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
    padding: `${tokens.space1} ${tokens.space2}`,
    borderRadius: tokens.radiusSm,
  },
  linkActive: {
    color: tokens.colorPrimary,
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space4,
  },
  email: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  signOut: {
    background: "transparent",
    border: "none",
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeSm,
  },
});

export default function Navbar() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header {...stylex.props(styles.header)}>
      <div {...stylex.props(styles.left)}>
        <div {...stylex.props(styles.brand)} onClick={() => navigate("/dashboard")}>
          dailogues
        </div>
        <nav {...stylex.props(styles.nav)}>
          <For each={LINKS}>
            {(link) => (
              <button
                {...stylex.props(styles.link, location.pathname.startsWith(link.path) && styles.linkActive)}
                onClick={() => navigate(link.path)}
              >
                {link.label}
              </button>
            )}
          </For>
        </nav>
      </div>
      <div {...stylex.props(styles.right)}>
        <span {...stylex.props(styles.email)}>{auth.user?.email}</span>
        <button {...stylex.props(styles.signOut)} onClick={() => auth.signOut()}>
          退出
        </button>
      </div>
    </header>
  );
}
