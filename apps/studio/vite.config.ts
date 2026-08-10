import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import stylex from "@stylexjs/unplugin";

// StyleX + Solid 集成：官方 @stylexjs/unplugin（框架无关 vite 插件，0.19）处理
// stylex.create/defineVars 编译，与 vite-plugin-solid 的 JSX 转换共存。
// dev 模式 runtimeInjection（样式注入 <style>）；build 产出独立 CSS。
export default defineConfig({
  plugins: [
    stylex.vite({
      dev: true,
      runtimeInjection: true,
      treeshakeCompensation: false,
    }),
    solid(),
  ],
  server: {
    port: 5173,
    // 本地域名绑定（SSO 测试）：orb 容器访问 app.orb.local
    allowedHosts: [".orb.local", ".dailog.local", ".127.0.0.1.sslip.io"],
    // 本地开发直连后端（api 侧 APP_ORIGINS 白名单 + CORS 双保险）。
    // orb 容器内经 compose 设 VITE_PROXY_TARGET=http://api:8787；本机跑默认 localhost
    proxy: { "/v1": process.env.VITE_PROXY_TARGET ?? "http://localhost:8787" },
  },
});
