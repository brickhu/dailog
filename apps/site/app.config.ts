import { defineConfig } from "@solidjs/start/config";
import stylex from "@stylexjs/unplugin";

// 消费端 SSR 站（dailogues.com）：
// - Nitro preset cloudflare-pages（SolidStart 1.x 部署方式，输出 dist）
// - StyleX unplugin（与 studio 同方案；build 产出独立 CSS，SSR 页面引用）
// orb 容器（compose 设 ORB=1）：HMR 固定端口 3001（publish 后浏览器直连）+ 跳过 ws token 校验
const inOrb = process.env.ORB === "1";

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
      // 本地域名绑定（SSO 测试）：orb 容器访问 site.orb.local
      allowedHosts: [".orb.local", ".dailog.local", ".127.0.0.1.sslip.io"],
  ...(inOrb
    ? {
        // HMR WebSocket 固定端口 3001（容器内监听；OrbStack 的 80 域名路由到
        // 最低监听端口 → 3000 正常服务，HMR 经 dailog.orb.local:3001 直连）
        hmr: { port: 3001 },
      }
    : {}),
    },
    // orb 容器内多 router（ssr/client）token 不一致 → 跳过 ws token 校验（仅容器 dev）
    ...(inOrb ? { legacy: { skipWebSocketTokenCheck: true } } : {}),
  },
});

