import { Route, Router } from "@solidjs/router";
import { render } from "solid-js/web";
import { AuthProvider } from "./lib/auth";
import { I18nProvider } from "@dailogues/i18n";
import { AppShell } from "./lib/guards";
import AppLayout from "./components/app-layout";
import EpisodesPage from "./pages/episodes";
import EpisodeDetailPage from "./pages/episode-detail";
import EditorPage from "./pages/editor";
import PolishesPage from "./pages/polishes";
import SettingsPage from "./pages/settings";
import CollectPage from "./pages/import";
import NotFound from "./pages/not-found";
import {Examples as ExamplePage} from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";
import "./main.css";
const styles = stylex.create({
  body: {
    minWidth: "320px",
    minHeight: "100vh",
    // 注意：StyleX 不支持简写属性（background），编译期会静默丢弃——必须用 backgroundColor
    backgroundColor: colors.background,
    color: colors.foreground,
    
  }
})

// SPA studio（app.dailog.fm）路由——无前缀，与主站完全区分。
// 两层 Context 守卫（AppShell）锁定式渲染：未登录 → 登录界面；onboarding 未完成 → onboarding 界面。
// URL（含 query）全程不变，解锁后回到原路径——因此无 /login、/onboarding 路由。
//   /                  导入页（默认页：粘贴分享链接 → 采集 → 确认入库）
//   /import            导入页（/ 的别名路由）
//   /episodes          节目管理
//   /polish/:id        创作容器编辑页（润色脚本 → 生成节目 → 发布）
//   /settings          设置
render(
  () => (
    <div {...stylex.props(styles.body)}>
      <I18nProvider>
      <AuthProvider>
        <Router>
          <Route path="/" component={AppShell}>
            <Route path="/" component={AppLayout}>
              <Route path="/" component={CollectPage} />
              <Route path="/import" component={CollectPage} />
              <Route path="/episodes" component={EpisodesPage} />
              <Route path="/episodes/:id" component={EpisodeDetailPage} />
              <Route path="/polish/:id" component={EditorPage} />
              <Route path="/polishes" component={PolishesPage} />
              <Route path="/settings" component={SettingsPage} />
            </Route>
            <Route path="/example" component={ExamplePage} />
            <Route path="*" component={NotFound} />
          </Route>
        </Router>
      </AuthProvider>
      </I18nProvider>
    </div>
  ),
  document.getElementById("root")!,
);
