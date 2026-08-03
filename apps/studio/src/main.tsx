import { Navigate, Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./lib/guards";
import AppLayout from "./components/app-layout";
import LoginPage from "./pages/login";
import EpisodesPage from "./pages/episodes";
import EditorPage from "./pages/editor";
import OnboardingPage from "./pages/onboarding";
import SettingsPage from "./pages/settings";
import NotFound from "./pages/not-found";

// SPA 工作台（dailogues.com/app/*）路由：
// /login 统一登录入口（计划 6 前由 SPA 兜底，之后主站 SSR 接管）
// /app 两列布局（RequireAuth 守卫 + 左导航）：
//   /app/episodes          节目管理（默认页）
//   /app/episodes/new      新增节目（四步向导）
//   /app/episodes/:id      续编辑草稿
//   /app/onboarding        频道初始化 + 录音（两步）
//   /app/settings          设置
render(
  () => (
    <AuthProvider>
      <Router>
        <Route path="/login" component={LoginPage} />
        <Route path="/app" component={RequireAuth}>
          <Route path="/app" component={AppLayout}>
            <Route path="/" component={() => <Navigate href="/app/episodes" />} />
            <Route path="/episodes" component={EpisodesPage} />
            <Route path="/episodes/new" component={EditorPage} />
            <Route path="/episodes/:id" component={EditorPage} />
            <Route path="/onboarding" component={OnboardingPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="*" component={NotFound} />
          </Route>
        </Route>
        <Route path="*" component={NotFound} />
      </Router>
    </AuthProvider>
  ),
  document.getElementById("root")!,
);
