import { Route, Router, type RouteSectionProps } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider, useAuth } from "./lib/auth";
import { I18nProvider, useI18n } from "@dailogues/i18n";
import { Show } from "solid-js";
import LoginPage from "./pages/login";
import QueuePage from "./pages/queue";
import ReviewPage from "./pages/review";
import SettingsPage from "./pages/settings";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import "./main.css";

// 管理员工作台（admin.dailog.fm）——编辑/管理员专用，普通用户无权限
// 守卫：未登录 → 登录视图；角色非 editor/admin → 无权限视图（URL 不变，登录/授权后自动解锁）
//   /            投稿队列（默认待审批 inbox）
//   /reviews/:id 审核详情（对话预览 → 审核+润色 → 脚本 → 生成 → 发布确认）
//   /settings    嘉宾管理

const styles = stylex.create({
  body: {
    minWidth: "320px",
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
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
  return (
    <Show when={!auth.loading()} fallback={<div {...stylex.props(styles.denied)}>{t("common.loading")}</div>}>
      <Show when={auth.user()} fallback={<LoginPage />}>
        <Show
          when={auth.role() === "editor" || auth.role() === "admin"}
          fallback={<div {...stylex.props(styles.denied)}>{t("admin.denied")}</div>}
        >
          {props.children}
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
              <Route path="/" component={QueuePage} />
              <Route path="/reviews/:id" component={ReviewPage} />
              <Route path="/settings" component={SettingsPage} />
            </Route>
          </Router>
        </AuthProvider>
      </I18nProvider>
    </div>
  ),
  document.getElementById("root")!,
);
