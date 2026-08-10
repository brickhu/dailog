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
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            {assets}
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
