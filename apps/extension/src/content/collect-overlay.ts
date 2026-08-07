// 采集蒙层：采集进行中整页覆盖（禁用鼠标点击/滚动，防止用户操作干扰
// 滚动扫描；滚动/点击事件被蒙层拦截，另锁定 body 滚动双保险）

let overlay: HTMLDivElement | null = null;
let prevBodyOverflow = "";

/** 显示蒙层（幂等）：「正在采集中...」+ 脉冲动画 */
export function showCollectOverlay(): void {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.setAttribute("dailog-overlay", ""); // 可识别标记（测试/调试）
  overlay.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483646", // 略低于 FAB（2147483647），高于页面一切内容
    "background:rgba(15,23,42,0.55)",
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "gap:14px",
    "cursor:wait",
    "user-select:none",
    "font-family:system-ui,-apple-system,sans-serif",
  ].join(";");
  overlay.innerHTML = `
    <div style="width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,0.25);border-top-color:#4ade80;animation:dailog-spin 0.9s linear infinite"></div>
    <div style="color:#fff;font-size:15px;letter-spacing:0.5px;animation:dailog-pulse 1.4s ease-in-out infinite">正在采集中...</div>
    <style>
      @keyframes dailog-spin { to { transform: rotate(360deg); } }
      @keyframes dailog-pulse { 0%,100% { opacity:1 } 50% { opacity:0.45 } }
    </style>`;
  // 拦截滚动/触摸（蒙层自身无可滚内容，事件不落到下层）
  overlay.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
  overlay.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  // 双保险：锁定 body 滚动
  prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.documentElement.appendChild(overlay);
}

/** 隐藏蒙层并恢复滚动（幂等） */
export function hideCollectOverlay(): void {
  overlay?.remove();
  overlay = null;
  document.body.style.overflow = prevBodyOverflow;
  prevBodyOverflow = "";
}
