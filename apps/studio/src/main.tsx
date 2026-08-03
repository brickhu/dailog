import { Router, Route } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./lib/guards";
import AuthPage from "./pages/auth";
import Dashboard from "./pages/dashboard";
import OnboardingVoice from "./pages/onboarding-voice";

// 路由结构：/auth 公开；其余在 RequireAuth 布局守卫下
// （Task 6-7 加 /episodes/new；Task 8 加 /settings）
render(
  () => (
    <AuthProvider>
      <Router>
        <Route path="/auth" component={AuthPage} />
        <Route path="/" component={RequireAuth}>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/onboarding/voice" component={OnboardingVoice} />
        </Route>
      </Router>
    </AuthProvider>
  ),
  document.getElementById("root")!,
);
