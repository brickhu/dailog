import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { MetaProvider } from "@solidjs/meta";
import { getRequestEvent } from "solid-js/web";
import { I18nProvider, detectLocale } from "@dailogues/i18n";
import { PlaybackProvider } from "./lib/playback";
import { PlayerBar } from "./components/player-bar";
import { SiteNav } from "./components/site-nav";
import { Footer } from "./components/footer";
import "./app.css";

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
              <Suspense>{props.children}</Suspense>
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
