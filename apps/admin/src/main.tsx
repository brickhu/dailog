import { For, Show } from "solid-js";
import { Route, Router, useLocation, useNavigate, type RouteSectionProps } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider, useI18n } from "@dailogues/i18n";
import LoginPage from "./pages/login";
import OverviewPage from "./pages/overview";
import ReviewsPage from "./pages/reviews";
import ReviewPage from "./pages/review";
import GeneratesPage from "./pages/generates";
import GeneratePage from "./pages/generate";
import PublishPage from "./pages/publish";
import EpisodesPage from "./pages/episodes";
import SettingsPage from "./pages/settings";
import ForbiddenPage from "./pages/forbidden";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import "./main.css";

// 管理员工作台（admin.dailog.fm）——编辑/管理员专用，普通用户无权限
// 守卫：未登录 → 登录视图；角色非 editor/admin → 无权限视图（URL 不变，登录/授权后自动解锁）
// 布局对齐 studio app-layout：左 sidebar（220px，品牌 + 一级导航 + 底部账号） + 右侧内容区
//   流程：/（概览）→ /reviews（审核列表）→ /reviews/:id（审核详情）
//         → /generates（生成任务列表）→ /generate/:id（生成任务详情）
//         → /publish/:id（发布确认）→ /episodes（已发布节目）
//   /settings 嘉宾管理

// 一级导航（左侧纵向）；active 用 pathname 前缀匹配
const NAV = [
  { path: "/", label: "admin.overview" },
  { path: "/reviews", label: "admin.reviews" },
  { path: "/generates", label: "admin.generates" },
  { path: "/episodes", label: "admin.publishedEpisodes" },
  { path: "/settings", label: "admin.guests" },
] as const;

const styles = stylex.create({
  body: {
    minWidth: "320px",
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
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
    color: colors.brandStrong,
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
    backgroundColor: "rgba(254, 232, 65, 0.14)",
    color: colors.foreground,
    fontWeight: dimensions.fontWeightMedium,
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
    textDecoration: "underline",
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  denied: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: dimensions.spacing3,
    color: colors.neutral,
  },
});

function AdminShell(props: RouteSectionProps) {
  const auth = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);
  return (
    <Show when={!auth.loading()} fallback={<div {...stylex.props(styles.denied)}>{t("common.loading")}</div>}>
      <Show when={auth.user()} fallback={<LoginPage />}>
        <Show
          when={auth.role() === "editor" || auth.role() === "admin"}
          fallback={<ForbiddenPage />}
        >
          <div {...stylex.props(styles.shell)}>
            <aside {...stylex.props(styles.sidebar)}>
              <a href="/" {...stylex.props(styles.brand)}>dailog</a>
              <nav {...stylex.props(styles.nav)}>
                <For each={NAV}>
                  {(item) => (
                    <button
                      type="button"
                      {...stylex.props(styles.link, isActive(item.path) && styles.linkActive)}
                      onClick={() => navigate(item.path)}
                    >
                      {t(item.label as never)}
                    </button>
                  )}
                </For>
              </nav>
              <div {...stylex.props(styles.footer)}>
                <span {...stylex.props(styles.email)}>{auth.user()?.email}</span>
                <button {...stylex.props(styles.signOut)} onClick={() => auth.signOut()}>
                  {t("nav.logout")}
                </button>
              </div>
            </aside>
            <main {...stylex.props(styles.main)}>
              {props.children}
            </main>
          </div>
        </Show>
      </Show>
    </Show>
  );
}

render(
  () => (
    <div {...stylex.props(styles.body)}>
      <I18nProvider>
        <AuthProvider>
          <Router>
            <Route path="/" component={AdminShell}>
              <Route path="/" component={OverviewPage} />
              <Route path="/reviews" component={ReviewsPage} />
              <Route path="/reviews/:id" component={ReviewPage} />
              <Route path="/generates" component={GeneratesPage} />
              <Route path="/generate/:id" component={GeneratePage} />
              <Route path="/publish/:id" component={PublishPage} />
              <Route path="/episodes" component={EpisodesPage} />
              <Route path="/settings" component={SettingsPage} />
            </Route>
          </Router>
        </AuthProvider>
      </I18nProvider>
    </div>
  ),
  document.getElementById("root")!,
);
