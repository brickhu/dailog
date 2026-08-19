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

// 构建守卫：CSS 产物 < 10KB 判定为空壳构建（stylex 构建期提取失败——SSR HTML 有类名、
// CSS 只剩 app.css reset ~1.2KB，页面无组件样式）。直接中止构建，防止坏构建被部署：
// dev 预览环境每次 push 自动部署，坏页一旦被 SW 缓存会在用户端永久卡死。
const MIN_CSS_BYTES = 10 * 1024;
function guardEmptyCss() {
  return {
    name: "guard-stylex-css",
    apply: "build" as const,
    writeBundle(_outputOptions: unknown, bundle: Record<string, { source?: unknown; code?: string }>) {
      for (const [name, asset] of Object.entries(bundle)) {
        if (!name.endsWith(".css")) continue;
        const source = asset.source;
        if (typeof source !== "string") continue;
        const size = Buffer.byteLength(source, "utf8");
        if (size < MIN_CSS_BYTES) {
          throw new Error(
            `[guard-stylex-css] CSS 空壳检测失败：${name} 仅 ${size}B（阈值 ${MIN_CSS_BYTES}B）。` +
              "stylex 构建期提取未生效（app.config.ts 的 runtimeInjection 是否误开为 true？），构建中止以防坏部署。"
          );
        }
      }
    },
  };
}

export default defineConfig({
  server: {
    preset: "cloudflare-pages",
    // 缓存策略：动态响应（SSR HTML / /v1/* 代理）一律 no-cache——陈旧 HTML 是「坏页
    // 卡死」的根因之一（HTML 无缓存头时浏览器/边缘缓存行为不可控）。/_build/assets/**
    // 的 immutable 规则由 SolidStart 默认注入，此处经 defu 深合并共存；/sw.js 与
    // manifest 的 no-cache 会由 nitro 生成进 _headers（静态文件侧生效）。
    routeRules: {
      "/**": { headers: { "cache-control": "no-cache" } },
      "/sw.js": { headers: { "cache-control": "no-cache" } },
      "/manifest.webmanifest": { headers: { "cache-control": "no-cache" } },
    },
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
      // 构建守卫：生产 CSS 空壳（<10KB）直接构建失败（见上方 guardEmptyCss 注释）
      guardEmptyCss(),
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
