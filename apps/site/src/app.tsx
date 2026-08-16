import { Router, RouterContext, useIsRouting, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createEffect, Show, Suspense, useContext, type JSX } from "solid-js";
import { MetaProvider } from "@solidjs/meta";
import { getRequestEvent } from "solid-js/web";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { I18nProvider, detectLocale } from "@dailogues/i18n";
import { CardGridSkeleton, DetailSkeleton, ListSkeleton } from "./components/route-skeletons";
import { PlaybackProvider } from "./lib/playback";
import { PlayerBar } from "./components/player-bar";
import { SiteNav } from "./components/site-nav";
import { Footer } from "./components/footer";
import "./app.css";

// 路由切换过渡：点击后立即"进入"目标页面 —— 内容区渲染全局骨架屏（结构化 shimmer），
// chunk/数据就绪后真实页面接管（骨架屏 → 内容，局部懒加载填充），不在原页面停留。
// 导航栏/播放条在过渡容器外，不中断。
// 路由出口：@solidjs/router 的导航是 transition（延迟提交）——chunk/数据加载完成前旧内容保持。
// isRouting=true 期间立即渲染**目标页面排版对应的骨架屏**（pendingTarget 取目标路径），
// 不在原页面停留；提交后真实页面接管。
// 路由出口：@solidjs/router 的导航是 transition（延迟提交）——chunk/数据加载完成前旧内容保持。
// isRouting=true 期间立即渲染**目标页面排版对应的骨架屏**（pendingTarget 取目标路径，
// 复用页面自身使用的骨架组件，与页面内 Suspense fallback 视觉一致）。
function PageSkeleton(props: { path: string }) {
  if (props.path.startsWith("/episode/")) return <DetailSkeleton />;
  if (["/discover", "/hosts", "/guests"].some((p) => props.path === p || props.path.startsWith(`${p}/`))) {
    return <ListSkeleton />;
  }
  return <CardGridSkeleton />;
}

function RouterOutlet(props: { children: JSX.Element }) {
  const isRouting = useIsRouting();
  const router = useContext(RouterContext);
  const targetPath = () => (isRouting() && router?.pendingTarget ? router.pendingTarget.value : "");
  return (
    <Show when={isRouting()} fallback={<Suspense fallback={<CardGridSkeleton />}>{props.children}</Suspense>}>
      <div {...stylex.props(layouts.page)}>
        <PageSkeleton path={targetPath()} />
      </div>
    </Show>
  );
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
