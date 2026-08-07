// 步进截取蒙层：采集进行中整页覆盖（阻断用户滚动/点击——滚动由扩展接管，
// 用户通过「上 / 取消」按钮逐屏驱动），面板显示已截取条数与状态。

export interface CollectMaskOptions {
  onUp: () => void;
  onCancel: () => void;
  onDone: () => void;
}

let mask: HTMLDivElement | null = null;
let upBtn: HTMLButtonElement | null = null;
let countEl: HTMLDivElement | null = null;
let statusEl: HTMLDivElement | null = null;
let done = false;
let prevBodyOverflow = "";

/** 显示蒙层（幂等）：阻断页面交互 + 上/取消按钮 + 截取计数 */
export function showCollectMask(opts: CollectMaskOptions): void {
  if (mask) return;
  done = false;
  mask = document.createElement("div");
  mask.setAttribute("dailog-mask", ""); // 可识别标记（测试/调试）
  mask.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483646", // 略低于 FAB（2147483647），高于页面一切内容
    "background:rgba(15,23,42,0.6)",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "font-family:system-ui,-apple-system,sans-serif",
  ].join(";");

  const panel = document.createElement("div");
  panel.style.cssText = [
    "width:300px",
    "background:#fff",
    "border-radius:16px",
    "box-shadow:0 12px 40px rgba(15,23,42,0.35)",
    "padding:20px",
    "display:flex",
    "flex-direction:column",
    "gap:12px",
    "text-align:center",
  ].join(";");

  const title = document.createElement("div");
  title.style.cssText = "font-size:15px;font-weight:700;color:#0f172a;";
  title.textContent = "步进截取";

  countEl = document.createElement("div");
  countEl.style.cssText = "font-size:13px;color:#334155;";
  countEl.textContent = "已截取 0 条";

  statusEl = document.createElement("div");
  statusEl.style.cssText = "font-size:12px;color:#94a3b8;line-height:1.5;";
  statusEl.textContent = "从底部逐屏向上截取，滚不动即完成";

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;margin-top:4px;";
  const upBtnStyle = [
    "flex:1",
    "padding:10px 0",
    "border:none",
    "border-radius:999px",
    "cursor:pointer",
    "background:#16a34a",
    "color:#fff",
    "font-size:15px",
    "font-weight:700",
  ].join(";");
  upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.style.cssText = upBtnStyle;
  upBtn.textContent = "上";
  upBtn.addEventListener("click", () => {
    if (done) opts.onDone();
    else opts.onUp();
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.style.cssText = [
    "padding:10px 18px",
    "border:1px solid #cbd5e1",
    "border-radius:999px",
    "cursor:pointer",
    "background:#fff",
    "color:#64748b",
    "font-size:14px",
    "font-weight:600",
  ].join(";");
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => opts.onCancel());
  row.append(upBtn, cancelBtn);
  panel.append(title, countEl, statusEl, row);

  mask.appendChild(panel);
  // 阻断页面滚动/触摸（蒙层自身无可滚内容，事件不落到下层）
  mask.addEventListener("wheel", (e) => e.preventDefault(), { passive: false });
  mask.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  // 双保险：锁定 body 滚动
  prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.documentElement.appendChild(mask);
}

/** 隐藏蒙层并恢复滚动（幂等） */
export function hideCollectMask(): void {
  mask?.remove();
  mask = null;
  upBtn = null;
  countEl = null;
  statusEl = null;
  done = false;
  document.body.style.overflow = prevBodyOverflow;
  prevBodyOverflow = "";
}

/** 更新已截取条数 */
export function updateMaskCount(n: number): void {
  if (countEl) countEl.textContent = `已截取 ${n} 条`;
}

/** 设置状态文案（如滚动被拦截的提示） */
export function setMaskStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

/** 到顶：主按钮「上」→「完成」（点击触发 onDone） */
export function setMaskDone(): void {
  done = true;
  if (upBtn) {
    upBtn.textContent = "完成";
    upBtn.style.background = "#0f172a";
  }
}
