import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import stylex from "@stylexjs/unplugin";

// StyleX + Solid 集成：官方 @stylexjs/unplugin（框架无关 vite 插件，0.19）处理
// stylex.create/defineVars 编译，与 vite-plugin-solid 的 JSX 转换共存。
// dev 模式 runtimeInjection（样式注入 <style>）；build 产出独立 CSS。
//
// 本地开发唯一路径 = OrbStack compose（pnpm dev:orb）——proxy 目标由 compose 注入
// （VITE_PROXY_TARGET=http://api:8787 / VITE_PROXY_ORIGIN=http://app.dailog.orb.local）；
// dev 启动缺 env 直接报错，不再支持本机直跑（防止指错端口/双套配置）。
export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const proxyTarget = process.env.VITE_PROXY_TARGET;
  const proxyOrigin = process.env.VITE_PROXY_ORIGIN;
  if (isDev && (!proxyTarget || !proxyOrigin)) {
    throw new Error(
      "[studio] 缺少 VITE_PROXY_TARGET / VITE_PROXY_ORIGIN——本地开发请用 pnpm dev:orb（OrbStack compose）",
    );
  }
  return {
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
      // 关闭 HMR：https 页面下 wss 连不上（容器 HMR 端口无 TLS），避免控制台刷屏
      hmr: false,
      // 本地域名绑定（SSO 测试）：orb 容器访问 app.dailog.orb.local
      allowedHosts: [".orb.local", ".dailog.local", ".127.0.0.1.sslip.io"],
      proxy: {
        "/v1": {
          target: proxyTarget!,
          // ① changeOrigin：Host 改写为目标（better-auth 按 Host 构造 baseURL，保留 app
          //    域名会导致 /v1/auth/* 404）② 同源请求无 Origin → 补 Origin（白名单内，
          //    CSRF 走 Origin 校验）
          changeOrigin: true,
          headers: { Origin: proxyOrigin! },
        },
      },
    },
  };
});
