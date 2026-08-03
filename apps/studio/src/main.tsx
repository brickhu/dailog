import { Router, Route } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider } from "./lib/auth";
import { RequireAuth } from "./lib/guards";
import AuthPage from "./pages/auth";
import Dashboard from "./pages/dashboard";
import OnboardingVoice from "./pages/onboarding-voice";
import NewEpisode from "./pages/new-episode";
import Settings from "./pages/settings";
import NotFound from "./pages/not-found";

render(
  () => (
    <AuthProvider>
      <Router>
        <Route path="/auth" component={AuthPage} />
        <Route path="/" component={RequireAuth}>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/onboarding/voice" component={OnboardingVoice} />
          <Route path="/episodes/new" component={NewEpisode} />
          <Route path="/settings" component={Settings} />
          <Route path="*" component={NotFound} />
        </Route>
      </Router>
    </AuthProvider>
  ),
  document.getElementById("root")!,
);
