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

// SPA studio（app.dailog.fm）路由——无前缀，与主站完全区分：
// /login SPA 本地兜底登录（计划 6 主站统一登录页上线后由守卫改跳 dailog.fm/login）
// 其余页面在 RequireAuth（登录 + 频道守卫）下：
//   /onboarding      频道初始化 + 录音（独立全屏，不套工作台导航）
//   工作台（AppLayout 两列布局）：
//   /episodes          节目管理（默认页）
//   /episodes/new      新增节目（四步向导）
//   /episodes/:id      续编辑草稿
//   /settings          设置
render(
  () => (
    <AuthProvider>
      <Router>
        <Route path="/login" component={LoginPage} />
        <Route path="/" component={RequireAuth}>
          {/* onboarding 独立全屏（无导航框架），与 /login 同级视觉；仍需登录 + 频道守卫 */}
          <Route path="/onboarding" component={OnboardingPage} />
          <Route path="/" component={AppLayout}>
            <Route path="/" component={() => <Navigate href="/episodes" />} />
            <Route path="/episodes" component={EpisodesPage} />
            <Route path="/episodes/new" component={EditorPage} />
            <Route path="/episodes/:id" component={EditorPage} />
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
