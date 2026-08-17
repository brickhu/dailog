import { createHandler, StartServer } from "@solidjs/start/server";
import { getRequestEvent } from "solid-js/web";
import { detectLocale } from "@dailogues/i18n";

export default createHandler(() => {
  // SSR 首帧语言（<html lang>）：cookie > accept-language > en（与 app.tsx 的 Provider 同源）
  const event = getRequestEvent();
  const locale = detectLocale({
    cookie: event?.request.headers.get("cookie"),
    acceptLanguage: event?.request.headers.get("accept-language"),
  });
  return (
    <StartServer
      document={({ assets, children, scripts }) => (
        <html lang={locale === "zh" ? "zh-CN" : "en"}>
          <head>
            <meta charset="utf-8" />
            {/* viewport-fit=cover：iOS 允许内容延伸到安全区（状态栏/刘海区域），
                配合 theme-color + safe-area-inset 实现沉浸式顶栏 */}
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
            {/* 状态栏/顶栏着色（iOS 15+ Safari 支持 theme-color；浅/暗跟随系统） */}
            <meta name="theme-color" content="#f9f9f9" media="(prefers-color-scheme: light)" />
            <meta name="theme-color" content="#0e1116" media="(prefers-color-scheme: dark)" />
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            {assets}
            {/* dev 消除 FOUC：首帧必须拿到样式才显示（见 entry-client 的 stylex-pre 移除逻辑）。
                两个关键点：
                1. vinxi 自动注入的 /_build/virtual:stylex.css 在 dev 服务器上返回 SSR HTML
                   （路径被路由接管），不是样式——真实 CSS 在 /virtual:stylex.css（runtime 模块
                   异步 fetch 后注入 style#__stylex_virtual__，首帧时未就绪）；
                2. 这里手动补 render-blocking link（/virtual:stylex.css）——浏览器首帧渲染前
                   必须加载完该样式，配合下面的 visibility 隐藏，彻底消除无样式 DOM 闪现 */}
            {import.meta.env.DEV && (
              <>
                <script>{`document.documentElement.classList.add('stylex-pre');`}</script>
                <link rel="stylesheet" href="/virtual:stylex.css" />
                <style>{`.stylex-pre body{visibility:hidden}`}</style>
              </>
            )}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      )}
    />
  );
});
