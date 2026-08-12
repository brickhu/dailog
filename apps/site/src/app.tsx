import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import { MetaProvider } from "@solidjs/meta";
import { getRequestEvent } from "solid-js/web";
import { I18nProvider, detectLocale } from "@dailogues/i18n";
import { ClipboardDetector } from "./components/clipboard-detector";
import "./app.css";

// 消费端应用根：文件路由（src/routes/* 自动生成路由）+ 语言上下文。
// SSR 首帧语言：由 request 的 accept-language/cookie 检测（entry-server 同步用于 <html lang>）
// ClipboardDetector：全站剪贴板检测（复制/粘贴到支持的分享链接 → 弹层引导投稿）
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
      <MetaProvider>
        <ClipboardDetector />
        <Router root={(props) => <Suspense>{props.children}</Suspense>}>
          <FileRoutes />
        </Router>
      </MetaProvider>
    </I18nProvider>
  );
}
