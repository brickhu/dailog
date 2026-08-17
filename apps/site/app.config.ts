import { defineConfig } from "@solidjs/start/config";
import stylex from "@stylexjs/unplugin";

// dev 样式 = unplugin runtimeInjection（每个模块转换后自带 _inject 调用，模块加载时
// 同步注入自身样式到 <style data-stylex>）。SPA 路由切换时样式随路由模块同步到达，
// 不再依赖「全局 CSS 收集 + HMR 事件」的事后注入链（那是 SPA 点击进入页面样式迟到的根因）。
// 整页加载首帧无样式由 entry-server/client 的「样式就绪前隐藏页面」方案消除（stylex-pre）。
// 生产构建走 unplugin 的构建期 CSS 提取（generateBundle，runtimeInjection=false），无此问题。
//
// orb 容器（compose 设 ORB=1）：HMR 跳过 ws token 校验。
// 本地开发唯一路径 = OrbStack compose（pnpm dev:orb）——非 orb 启动 dev 仅提示，不阻断
// （生产构建同样走非 orb 分支）
const inOrb = process.env.ORB === "1";
// dev 用 per-module runtime injection（消除 SPA 导航 FOUC）；生产保持构建期静态 CSS 提取
const devRuntimeInjection = process.env.NODE_ENV !== "production";
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
        // 生产：runtimeInjection=false → 构建期提取独立 CSS（generateBundle 注入产物）。
        // dev：runtimeInjection=true → 每个模块转换后自带 _inject 调用，加载即同步注入样式。
        runtimeInjection: devRuntimeInjection,
        treeshakeCompensation: false,
      }),
      // dev 下 unplugin 自动注入的 <link href="/_build/virtual:stylex.css"> 是坏链：
      // vinxi 的 base 前缀（/_build）使 unplugin dev 中间件（只匹配 /virtual:stylex.css）
      // 不命中，该请求落到 SSR 路由返回整页 HTML——每次加载浪费一次 SSR 渲染，且控制台
      // 报 CSS 解析错误。runtimeInjection 模式下 dev 样式本就由模块自带的 _inject 注入，
      // 这条 link 纯属噪音，这里在 dev 直接删掉（须排在 stylex.vite 之后：
      // transformIndexHtml 同序执行）。
      {
        name: "drop-broken-stylex-css-link",
        apply: "serve",
        transformIndexHtml(html: string) {
          return html.replace(/<link[^>]*href="\/_build\/virtual:stylex\.css"[^>]*>/g, "");
        },
      },
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
