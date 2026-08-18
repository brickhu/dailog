import { mount, StartClient } from "@solidjs/start/client";

const root = document.getElementById("app");
if (!root) throw new Error("root #app not found");
mount(() => <StartClient />, root);

// dev 消除 FOUC（见 entry-server 的 stylex-pre）：guard 移除必须等「样式真正就绪」。
// 样式交付 = unplugin runtimeInjection（app.config）：每个模块转换后自带 _inject 调用，
// 模块加载时同步注入自身样式到 <style data-stylex>——SPA 路由切换时样式随路由模块同步
// 到达（模块求值先于组件渲染），整页加载时 hydration 执行全部模块即完成注入。
// 就绪判定（任一）：
//   1. style[data-stylex] 已存在且非空（runtimeInjection 模式，主路径）；
//   2. 旧 dev CSS 收集模式（容器重启前的过渡态）：style#__stylex_virtual__ 非空
//      或 render-blocking link（/virtual:stylex.css）cssRules 非空。
// 20s 兜底：异常时无论如何显示，避免永久白屏。
// PWA：生产环境注册 service worker（离线壳缓存 + 安装能力）。
// dev 不注册——避免开发期被 SW 缓存陈旧资源干扰调试。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* 静默失败：SW 不可用不影响站点功能 */
    });
  });
}

if (import.meta.env.DEV) {
  const reveal = () => document.documentElement.classList.remove("stylex-pre");
  const stylesReady = () => {
    try {
      const el = document.querySelector("style[data-stylex]") as HTMLStyleElement | null;
      if (el && el.sheet && el.sheet.cssRules.length > 0) return true;
    } catch { /* 忽略 */ }
    try {
      const v = document.getElementById("__stylex_virtual__");
      if (v && v.textContent.trim().length > 0) return true;
      for (const sheet of document.styleSheets) {
        if (sheet.href?.includes("virtual:stylex.css") && sheet.cssRules.length > 0) return true;
      }
    } catch { /* 忽略 */ }
    return false;
  };
  const check = () => (stylesReady() ? reveal() : requestAnimationFrame(check));
  requestAnimationFrame(check);
  setTimeout(reveal, 20000);
}
