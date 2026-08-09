import { defineConfig } from "@solidjs/start/config";
import stylex from "@stylexjs/unplugin";

// 消费端 SSR 站（dailogues.com）：
// - Nitro preset cloudflare-pages（SolidStart 1.x 部署方式，输出 dist）
// - StyleX unplugin（与 studio 同方案；build 产出独立 CSS，SSR 页面引用）
export default defineConfig({
  server: {
    preset: "cloudflare-pages",
  },
  vite: {
    plugins: [
      stylex.vite({
        dev: true,
        runtimeInjection: true,
        treeshakeCompensation: false,
      }),
    ],
    ssr: {
      // 共享设计包是 TS 源码分发（不预编译）：Nitro 必须打包它，不能 externalize
      noExternal: ["@dailogues/ui"],
    },
    server: {
      // 本地域名绑定（SSO 测试）：允许 *.dailog.local 访问 dev server
      allowedHosts: [".dailog.local", ".127.0.0.1.sslip.io"],
    },
  },
});
