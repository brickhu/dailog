import { defineConfig } from "@solidjs/start/config";
import stylex from "@stylexjs/unplugin";
import type { Plugin } from "vite";

// 修复 unplugin 0.19 与 vinxi base 的兼容问题：unplugin 注入的 stylex css link 带 base
// 前缀（/_build/virtual:stylex.css），但其 dev 中间件只匹配无前缀的 /virtual:stylex.css
// → link 变死链（SPA fallback 返回 HTML）→ 首帧无样式 + 闪烁（FOUC，样式全靠 JS 注入）。
// 重写为无前缀路径：浏览器 render-blocking 加载真实 CSS，首帧即有样式。
function fixStylexCssLink(): Plugin {
  return {
    name: "fix-stylex-css-link",
    // 仅 dev：生产构建走 unplugin 的构建期 CSS 提取，不需要
    transformIndexHtml() {
      if (process.env.NODE_ENV === "production") return null;
      // unplugin 注入的死链（/_build/virtual:stylex.css，base 前缀不命中其中间件）由
      // 其 runtime 脚本自动禁用；这里补一个无前缀的可服务 link → 浏览器 render-blocking
      // 加载真实 CSS（/virtual:stylex.css），首帧即有样式，消除 FOUC 闪烁。
      return [{
        tag: "link",
        attrs: { rel: "stylesheet", href: "/virtual:stylex.css" },
        injectTo: "head",
      }];
    },
  };
}

// 消费端 SSR 站（dailogues.com）：
// - Nitro preset cloudflare-pages（SolidStart 1.x 部署方式，输出 dist）
// - StyleX unplugin（与 studio 同方案；build 产出独立 CSS，SSR 页面引用）
// orb 容器（compose 设 ORB=1）：HMR 固定端口 3001（publish 后浏览器直连）+ 跳过 ws token 校验。
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
        // runtimeInjection=true（默认）时样式编译成 JS 注入调用，dev CSS 收集为空
        // （/virtual:stylex.css 返回 0 字节）→ 首帧无样式 + FOUC 闪烁。
        // false → 样式提取为 CSS 文本（中间件可服务），配合下方 link 修复实现首帧有样式。
        runtimeInjection: false,
        treeshakeCompensation: false,
      }),
      fixStylexCssLink(),
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

