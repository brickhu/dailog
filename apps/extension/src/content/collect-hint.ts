// 采集提示条：监测采集模式下的引导（非阻断——pointer-events:none，
// 不拦截鼠标点击/滚动，用户必须能自由滚动浏览对话）

let hint: HTMLDivElement | null = null;

/** 显示提示条（幂等）：「已锁定到底部，请向上滚动浏览完整对话，内容自动采集」 */
export function showCollectHint(text?: string): void {
  if (hint) return;
  hint = document.createElement("div");
  hint.setAttribute("dailog-hint", ""); // 可识别标记（测试/调试）
  hint.style.cssText = [
    "position:fixed",
    "top:16px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483646", // 略低于 FAB（2147483647），高于页面一切内容
    "padding:8px 16px",
    "border-radius:999px",
    "background:rgba(15,23,42,0.92)",
    "color:#fff",
    "font-size:13px",
    "line-height:1.5",
    "pointer-events:none", // 不阻断用户滚动/点击
    "font-family:system-ui,-apple-system,sans-serif",
    "box-shadow:0 4px 16px rgba(15,23,42,0.3)",
  ].join(";");
  hint.textContent = text ?? "已锁定到底部：向上滚动，消息进入视窗即选中（变绿）；向下滚动滚过取消；滚到顶部点「完成」";
  document.documentElement.appendChild(hint);
}

/** 更新提示条文案（已显示时；未显示无操作） */
export function updateCollectHint(text: string): void {
  if (hint) hint.textContent = text;
}

/** 隐藏提示条（幂等） */
export function hideCollectHint(): void {
  hint?.remove();
  hint = null;
}

// ============ 扫码线（视窗纵向中线的固定扫描线，采集期间可见） ============

let scanline: HTMLDivElement | null = null;

/** 显示扫码线（幂等）：消息扫过中线即选中（变绿入库），向下滚回中线以下取消 */
export function showScanline(): void {
  if (scanline) return;
  scanline = document.createElement("div");
  scanline.setAttribute("dailog-scanline", ""); // 可识别标记（测试/调试）
  scanline.style.cssText = [
    "position:fixed",
    "left:0",
    "right:0",
    "top:50%",
    "height:2px",
    "z-index:2147483645", // 略低于提示条/FAB，高于页面内容
    "pointer-events:none", // 不阻断交互
    "background:linear-gradient(90deg,transparent,rgba(74,222,128,0.95) 15%,rgba(74,222,128,0.95) 85%,transparent)",
    "box-shadow:0 0 10px rgba(74,222,128,0.9)",
  ].join(";");
  document.documentElement.appendChild(scanline);
}

/** 隐藏扫码线（幂等） */
export function hideScanline(): void {
  scanline?.remove();
  scanline = null;
}
