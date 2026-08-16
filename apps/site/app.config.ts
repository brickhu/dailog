import { defineConfig } from "@solidjs/start/config";
import stylex from "@stylexjs/unplugin";

// dev 样式 = unplugin runtime JS 注入（vinxi SSR 编译不经过 unplugin 的 transform 钩子，
// dev CSS 收集恒为空，/virtual:stylex.css 0 字节——FOUC 无法靠 dev CSS link 消除）。
// 首帧无样式闪烁由 entry-server/client 的「hydration 完成前隐藏页面」方案消除（stylex-pre）。
// 生产构建走 unplugin 的构建期 CSS 提取（generateBundle），无此问题。
//
// orb 容器（compose 设 ORB=1）：HMR 跳过 ws token 校验。
// 本地开发唯一路径 = OrbStack compose（pnpm dev:orb）——非 orb 启动 dev 仅提示，不阻断
// （生产构建同样走非 orb 分支）
const inOrb = process.env.ORB === "1";
if (!inOrb && process.env.NODE_ENV !== "production") {
  console.warn("[site] 非 orb 环境启动 dev——本地开发请用 pnpm dev:orb（OrbStack compose）");
}

export default defineConfig({
  server: {
    preset: "cloudflare-pages",
  },
  vite: {
    plugins: [
      stylex.vite({
        dev: true,
        // runtimeInjection=false：构建产物提取独立 CSS（生产）；dev 下样式走 runtime JS 注入
        runtimeInjection: false,
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
        // HMR 用 vite 默认（dev server 同端口 80）：页面 https://dailog.orb.local →
        // OrbStack 443 TLS → 80 → dev server ws upgrade ✓。
        // 之前固定 3001 端口是错的——3001 无 TLS，https 页面 wss 必失败刷屏
      }
    : {}),
    },
    // orb 容器内多 router（ssr/client）token 不一致 → 跳过 ws token 校验（仅容器 dev）
    ...(inOrb ? { legacy: { skipWebSocketTokenCheck: true } } : {}),
  },
});
