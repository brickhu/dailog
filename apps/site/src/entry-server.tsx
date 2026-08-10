import { createHandler, StartServer } from "@solidjs/start/server";
import { env } from "./lib/env";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {assets}
        </head>
        <body>
          {/* SSR 注入服务端 env → 客户端 lib/env.ts 直接读（一套变量两端共用，无需 VITE_ 双份） */}
          <script innerHTML={`window.__ENV__ = ${JSON.stringify(env)}`} />
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
