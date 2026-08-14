import { Router, useIsRouting, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { createEffect, For, Show, Suspense, type JSX } from "solid-js";
import { MetaProvider } from "@solidjs/meta";
import { getRequestEvent } from "solid-js/web";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { I18nProvider, detectLocale } from "@dailogues/i18n";
import { PlaybackProvider } from "./lib/playback";
import { PlayerBar } from "./components/player-bar";
import { SiteNav } from "./components/site-nav";
import { Footer } from "./components/footer";
import "./app.css";

// 路由切换过渡：点击后立即"进入"目标页面 —— 内容区渲染全局骨架屏（结构化 shimmer），
// chunk/数据就绪后真实页面接管（骨架屏 → 内容，局部懒加载填充），不在原页面停留。
// 导航栏/播放条在过渡容器外，不中断。
const routeSkeleton = stylex.create({
  wrap: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: `${dimensions.spacing8}`,
    // 页面组件被替换期间必须自带背景：否则透出 app.css 的 body 白色（全站背景由
    // 页面容器提供，骨架阶段没有页面容器）→ 骨架屏与全站背景色不一致。
    backgroundColor: colors.background,
    minHeight: "60vh", // 骨架高度与常见页面接近，避免内容高度骤变引起滚动跳动
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": {
      padding: dimensions.spacing4,
      gap: dimensions.spacing3,
    },
  },
  block: {
    backgroundColor: colors.surface,
    animationName: stylex.keyframes({
      from: { opacity: 0.55 },
      to: { opacity: 1 },
    }),
    animationDuration: "0.9s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
    animationDirection: "alternate",
  },
  title: {
    height: "32px",
    width: "55%",
    borderRadius: dimensions.radiusSm,
  },
  line: {
    height: "16px",
    width: "90%",
    borderRadius: dimensions.radiusSm,
  },
  lineShort: {
    width: "65%",
  },
  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: dimensions.spacing5,
    marginTop: dimensions.spacing4,
    "@media (max-width: 640px)": {
      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
      gap: dimensions.spacing4,
    },
  },
  card: {
    aspectRatio: "3 / 4",
    borderRadius: dimensions.radiusMd,
  },
});

function RouteSkeleton() {
  return (
    <div {...stylex.props(routeSkeleton.wrap)} role="status" aria-label="loading">
      <div {...stylex.props(routeSkeleton.block, routeSkeleton.title)} />
      <div {...stylex.props(routeSkeleton.block, routeSkeleton.line)} />
      <div {...stylex.props(routeSkeleton.block, routeSkeleton.line, routeSkeleton.lineShort)} />
      <div {...stylex.props(routeSkeleton.cards)}>
        <For each={[0, 1, 2, 3]}>
          {() => <div {...stylex.props(routeSkeleton.block, routeSkeleton.card)} />}
        </For>
      </div>
    </div>
  );
}

// 路由出口：@solidjs/router 的导航是 transition（延迟提交）——URL 已变但 chunk/数据
// 加载完成前旧内容保持。isRouting=true 期间立即渲染目标页面骨架屏（不在原页面停留），
// 提交后真实页面接管；createAsync 若仍挂起则由 Suspense fallback 继续显示骨架。
function RouterOutlet(props: { children: JSX.Element }) {
  const isRouting = useIsRouting();
  return (
    <Show when={isRouting()} fallback={<Suspense fallback={<RouteSkeleton />}>{props.children}</Suspense>}>
      <RouteSkeleton />
    </Show>
  );
}

// 消费端应用根：文件路由（src/routes/* 自动生成路由）+ 语言上下文 + 全局播放器。
// 应用壳布局：fixed 100vw×100vh 容器（导航/播放条固定），页面内容在壳内内容区滚动——
// 路由切换、骨架屏、滚动行为都稳定在壳内，不引发页面级跳动。
// SSR 首帧语言：由 request 的 accept-language/cookie 检测（entry-server 同步用于 <html lang>）
const shell = stylex.create({
  root: {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.background,
  },
  content: {
    flex: "1",
    minHeight: "0", // 允许 flex 子项收缩，内容区独立滚动
    overflowY: "auto",
    overscrollBehavior: "contain", // 滚动链限制在壳内
  },
});

function AppShell(props: { children: JSX.Element }) {
  const location = useLocation();
  let contentRef: HTMLDivElement | undefined;
  // 路由切换后内容区回顶（window 不再滚动，滚动发生在内容区）
  createEffect(() => {
    location.pathname;
    if (contentRef) contentRef.scrollTop = 0;
  });
  return (
    <div {...stylex.props(shell.root)}>
      {/* 全局导航单实例（路由切换不重挂载——避免会话/头像重复加载跳动） */}
      <SiteNav />
      <div ref={contentRef} {...stylex.props(shell.content)}>
        <RouterOutlet>{props.children}</RouterOutlet>
        <Footer />
      </div>
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
