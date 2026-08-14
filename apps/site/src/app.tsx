import { Router, useIsRouting } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { For, Show, Suspense, type JSX } from "solid-js";
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
