import { mount, StartClient } from "@solidjs/start/client";

const root = document.getElementById("app");
if (!root) throw new Error("root #app not found");
mount(() => <StartClient />, root);

// dev 消除 FOUC（见 entry-server 的 stylex-pre）：guard 移除必须等「样式真正就绪」——
// 两个就绪信号（任一即可）：
//   1. render-blocking link（/virtual:stylex.css）已加载应用（cssRules 可读且非空）；
//   2. stylex runtime 已异步 fetch 并注入 style#__stylex_virtual__（内容非空）。
// 之前用 rAF 硬等：样式 fetch 未完成就移除 → 无样式 DOM 闪现（dev 冷编译/清缓存后必现）。
// 5s 兜底：异常（如 CSS 路径失效）时无论如何显示，避免永久白屏。
if (import.meta.env.DEV) {
  const reveal = () => document.documentElement.classList.remove("stylex-pre");
  const stylesReady = () => {
    try {
      for (const sheet of document.styleSheets) {
        if (sheet.href?.includes("virtual:stylex.css") && sheet.cssRules.length > 0) return true;
      }
    } catch {
      /* 同源 sheet 可读；异常时忽略，走 runtime 注入检查 */
    }
    const el = document.getElementById("__stylex_virtual__");
    return !!el && el.textContent.length > 0;
  };
  const check = () => (stylesReady() ? reveal() : requestAnimationFrame(check));
  requestAnimationFrame(check);
  setTimeout(reveal, 5000);
}
