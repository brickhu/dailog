import { Router, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createEffect, Suspense, type JSX } from "solid-js";
import { MetaProvider } from "@solidjs/meta";
import { getRequestEvent } from "solid-js/web";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { I18nProvider, detectLocale } from "@dailogues/i18n";
import { PageSpinner } from "./components/page-loading";
import { PlaybackProvider } from "./lib/playback";
import { PlayerBar } from "./components/player-bar";
import { AuthGuardDialog, SignOutConfirmDialog } from "./lib/auth-guard";
import { ImportDialog } from "./components/import-dialog";
import { SiteNav } from "./components/site-nav";
import { Footer } from "./components/footer";
import "./app.css";

// 路由出口：不再做全局路由过渡骨架屏。@solidjs/router 导航是 transition（延迟提交），
// 但 hover/触摸预载（router 默认 preload）保证点击时 chunk 已就绪 → 立即提交，
// 目标页壳随即渲染；异步数据由各页面内部的 <Suspense fallback={spinner/骨架}> 处理。
// 这里仅兜底懒加载 chunk（预载缺失时），用轻量 spinner 而非整页骨架屏。
function RouterOutlet(props: { children: JSX.Element }) {
  return <Suspense fallback={<PageSpinner />}>{props.children}</Suspense>;
}

// 消费端应用根：文件路由（src/routes/* 自动生成路由）+ 语言上下文 + 全局播放器。
// 应用壳布局（layouts.shellRoot/shellContent）：fixed 100vw×100vh 容器（导航/播放条
// 固定），页面内容在壳内内容区滚动——路由切换、骨架屏、滚动行为都稳定在壳内。
// SSR 首帧语言：由 request 的 accept-language/cookie 检测（entry-server 同步用于 <html lang>）
function AppShell(props: { children: JSX.Element }) {
  const location = useLocation();
  let shellRef: HTMLDivElement | undefined;
  // 路由切换后整壳回顶（shellRoot 为纵向滚动容器）
  createEffect(() => {
    location.pathname;
    if (shellRef) shellRef.scrollTop = 0;
  });
  return (
    <div ref={shellRef} {...stylex.props(layouts.shellRoot)}>
      {/* 全局导航单实例（路由切换不重挂载——避免会话/头像重复加载跳动） */}
      <SiteNav />
      <RouterOutlet>{props.children}</RouterOutlet>
      <Footer />
      <PlayerBar />
      {/* 全局弹层（AppShell 内单例）：登录引导（use:auth 触发）+ 登出确认 */}
      <AuthGuardDialog />
      <SignOutConfirmDialog />
      <ImportDialog />
    </div>
  );
}

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
          <Router root={(props) => <AppShell>{props.children}</AppShell>}>
            <FileRoutes />
          </Router>
        </MetaProvider>
      </PlaybackProvider>
    </I18nProvider>
  );
}
