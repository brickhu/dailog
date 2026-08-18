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
            {/* PWA：manifest 使站点可安装（Android Chrome 地址栏/菜单出现「安装应用」）+
                iOS Safari 安装元数据（apple-touch-icon 不带圆角——iOS 自动切圆） */}
            <link rel="manifest" href="/manifest.webmanifest" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-title" content="dailog" />
            <meta name="apple-mobile-web-app-status-bar-style" content="default" />
            <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
            {assets}
            {/* dev 消除 FOUC：首帧必须拿到样式才显示（见 entry-client 的 stylex-pre 移除逻辑）。
                样式交付 = unplugin runtimeInjection：每个模块转换后自带 _inject 调用，模块加载
                时同步注入 <style data-stylex>（SPA 路由切换同样同步生效）。整页加载时 hydration
                执行全部模块即完成注入；在注入完成前用 visibility 隐藏 body，杜绝无样式首帧。
                注：unplugin 注入的 /_build/virtual:stylex.css 是坏链（vinxi base 前缀导致中间件
                不命中、返回 SSR HTML），由 app.config 的 drop-broken-stylex-css-link 插件移除；
                /virtual:stylex.css 在 runtimeInjection 模式下为空，不再手动挂载。 */}
            {import.meta.env.DEV && (
              <>
                <script>{`document.documentElement.classList.add('stylex-pre');`}</script>
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
