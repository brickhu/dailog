import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import stylex from "@stylexjs/unplugin";

// 管理员工作台（admin.dailog.fm）：Vite + Solid + StyleX（与 studio 同构配置）
// 本地开发唯一路径 = OrbStack compose（VITE_PROXY_TARGET / VITE_PROXY_ORIGIN 注入）
export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const proxyTarget = process.env.VITE_PROXY_TARGET;
  const proxyOrigin = process.env.VITE_PROXY_ORIGIN;
  if (isDev && (!proxyTarget || !proxyOrigin)) {
    throw new Error(
      "[admin] 缺少 VITE_PROXY_TARGET / VITE_PROXY_ORIGIN——本地开发请用 pnpm dev:orb（OrbStack compose）",
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
      port: 5174,
      // 关闭 HMR：https 页面下 wss 连不上（容器 HMR 端口无 TLS），避免控制台刷屏
      hmr: false,
      allowedHosts: [".orb.local", ".dailog.local", ".127.0.0.1.sslip.io"],
      proxy: {
        "/v1": {
          target: proxyTarget!,
          changeOrigin: true,
          headers: { Origin: proxyOrigin! },
        },
      },
    },
  };
});
