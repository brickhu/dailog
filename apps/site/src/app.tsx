import { Router, useIsRouting } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Show, Suspense, type JSX } from "solid-js";
import { MetaProvider } from "@solidjs/meta";
import { getRequestEvent } from "solid-js/web";
import * as stylex from "@stylexjs/stylex";
import { Spinner } from "@dailogues/ui";
import { colors } from "@dailogues/ui/theme.stylex";
import { I18nProvider, detectLocale } from "@dailogues/i18n";
import { PlaybackProvider } from "./lib/playback";
import { PlayerBar } from "./components/player-bar";
import { SiteNav } from "./components/site-nav";
import { Footer } from "./components/footer";
import "./app.css";

// 路由切换/数据加载过渡（导航栏/播放条在过渡容器外，不中断）：
// - 过渡期（isRouting=true）：旧内容保留 + 半透明遮罩 + 居中 spinner —— 无白块、无布局跳动
// - 数据挂起兜底（Suspense fallback）：内容区居中 spinner
const routeLoading = stylex.create({
  wrap: {
    position: "relative", // 遮罩以内容区为边界（absolute inset 0）
  },
  mask: {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.15)", // 轻微压暗旧内容（浅色/暗色模式通用）
    color: colors.neutral,
  },
  fallback: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "60vh",
    color: colors.neutral,
  },
});

function RouteLoading() {
  return (
    <div {...stylex.props(routeLoading.fallback)} role="status" aria-label="loading">
      <Spinner size={28} />
    </div>
  );
}

// 路由出口：@solidjs/router 的导航是 transition（延迟提交）——URL 已变但 chunk/数据
// 加载完成前 UI 保持旧页面且无反馈。isRouting=true 期间叠加遮罩 + spinner（旧内容
// 保留可见，避免内容区被替换成空白容器造成"白块晃动"），提交后交给 Suspense。
function RouterOutlet(props: { children: JSX.Element }) {
  const isRouting = useIsRouting();
  return (
    <div {...stylex.props(routeLoading.wrap)}>
      <Suspense fallback={<RouteLoading />}>{props.children}</Suspense>
      <Show when={isRouting()}>
        <div {...stylex.props(routeLoading.mask)} role="status" aria-label="loading">
          <Spinner size={28} />
        </div>
      </Show>
    </div>
  );
}

// 消费端应用根：文件路由（src/routes/* 自动生成路由）+ 语言上下文 + 全局播放器。
// 传统博客路由架构：各页面正常渲染；全局播放条（PlayerBar）贯通全站，播放不中断。
// SSR 首帧语言：由 request 的 accept-language/cookie 检测（entry-server 同步用于 <html lang>）
export default function App() {
  const event = getRequestEvent();
  const initialLocale = event
    ? detectLocale({
        cookie: event.request.headers.get("cookie"),
        acceptLanguage: event.request.headers.get("accept-language"),
      })
    : undefined;
  return (
    <I18nProvider initialLocale={initialLocale}>
      <PlaybackProvider>
        <MetaProvider>
          <Router root={(props) => (
            <>
              {/* 全局导航单实例（路由切换不重挂载——避免会话/头像重复加载跳动） */}
              <SiteNav />
              {/* 路由级 loading：点击跳转立即生效（transition 期间 isRouting=true），
                  数据加载期间内容区显示通用 spinner */}
              <RouterOutlet>{props.children}</RouterOutlet>
              <Footer />
              <PlayerBar />
            </>
          )}>
            <FileRoutes />
          </Router>
        </MetaProvider>
      </PlaybackProvider>
    </I18nProvider>
  );
}
