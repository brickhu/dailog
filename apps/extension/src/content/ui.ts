// 浮动采集按钮 UI：Shadow DOM 隔离样式，避免被页面 CSS 污染

export interface FabController {
  setBusy(busy: boolean): void;
  /** SPA 导航下按 URL 显隐（如 claude.ai 首页不显示按钮，进入对话页后显示） */
  setVisible(visible: boolean): void;
  /** 当前对话已采集过：按钮切「已采集 ↻」（刷新图标，点击重采集替换旧条目） */
  setCollected(collected: boolean): void;
  /** 监测采集态：FAB 变「完成 (N)」+ 放弃小按钮（用户滚动浏览对话，轮询暂存） */
  setCollecting(count: number, opts: { onAbandon: () => void }): void;
  /** 监测采集进行中实时更新条数（不切换状态） */
  updateCollectCount(count: number): void;
  /** 确认态：FAB 变「确认导入 (N)」+ 放弃小按钮（点击 FAB = 确认入库） */
  setConfirm(on: boolean, count: number, onAbandon?: () => void): void;
  showToast(text: string, kind: "success" | "error"): void;
  destroy(): void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; right: 24px; bottom: 24px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: system-ui, -apple-system, sans-serif; }
button.fab {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 18px; border: none; border-radius: 999px; cursor: pointer;
  background: #0f172a; color: #fff; font-size: 14px; font-weight: 600;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.35); transition: transform 0.12s ease, opacity 0.12s ease;
}
button.fab:hover { transform: translateY(-1px); }
button.fab:active { transform: translateY(0); }
button.fab:disabled { opacity: 0.6; cursor: wait; }
button.fab .dot { width: 8px; height: 8px; border-radius: 50%; background: #34d399; }
button.fab.busy .dot { background: #fbbf24; animation: pulse 1s infinite; }
button.fab.collecting .dot { animation: pulse 1.2s infinite; }
button.fab.confirm { background: #16a34a; }
button.fab.confirm .check { font-size: 14px; line-height: 1; }
button.fab.collected { background: #334155; }
button.fab.collected .refresh { font-size: 15px; line-height: 1; }
button.abandon {
  padding: 4px 14px; border: 1px solid #cbd5e1; border-radius: 999px; cursor: pointer;
  background: #fff; color: #64748b; font-size: 12px; font-weight: 600;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.12);
}
button.abandon:hover { background: #f1f5f9; }
@keyframes pulse { 50% { opacity: 0.3; } }
.toast {
  max-width: 260px; padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.4;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15); opacity: 0; transform: translateY(4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.toast.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
`;

export function createFab(opts: { onClick: () => void }): FabController {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.hidden = true;
  wrap.appendChild(toast);

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.type = "button";
  fab.addEventListener("click", opts.onClick);
  wrap.appendChild(fab);

  const abandon = document.createElement("button");
  abandon.className = "abandon";
  abandon.textContent = "放弃";
  abandon.type = "button";
  abandon.hidden = true;
  wrap.insertBefore(abandon, fab);

  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let collected = false;
  let phase: "idle" | "collecting" | "confirm" = "idle";
  let count = 0;

  function render() {
    const label = busy
      ? "采集中…"
      : phase === "collecting"
        ? `完成 (${count})`
        : phase === "confirm"
          ? `确认导入 (${count})`
          : collected
            ? "已采集"
            : "采集对话";
    const icon = busy
      ? '<span class="dot"></span>'
      : phase === "collecting"
        ? '<span class="dot"></span>'
        : phase === "confirm"
          ? '<span class="check">✓</span>'
          : collected
            ? '<span class="refresh">↻</span>'
            : '<span class="dot"></span>';
    fab.innerHTML = `${icon}<span>${label}</span>`;
  }

  /** 回到默认态（采集/确认结束、被 setCollected 等触发） */
  function resetInteractive(): void {
    phase = "idle";
    count = 0;
    abandon.hidden = true;
    fab.classList.remove("collecting", "confirm");
  }

  render();

  return {
    setBusy(b: boolean) {
      busy = b;
      fab.disabled = b;
      fab.classList.toggle("busy", b);
      render();
    },
    setVisible(visible) {
      wrap.style.display = visible ? "" : "none";
    },
    setCollected(c: boolean) {
      if (!busy) resetInteractive();
      collected = c;
      fab.classList.toggle("collected", c);
      render();
    },
    setCollecting(n, { onAbandon }) {
      resetInteractive();
      phase = "collecting";
      count = n;
      abandon.hidden = false;
      abandon.onclick = () => onAbandon();
      fab.classList.add("collecting");
      render();
    },
    updateCollectCount(n) {
      if (phase === "collecting" || phase === "confirm") {
        count = n;
        render();
      }
    },
    setConfirm(on, n, onAbandon) {
      if (on) {
        phase = "confirm";
        count = n;
        abandon.hidden = false;
        abandon.onclick = onAbandon ? () => onAbandon() : null;
        fab.classList.add("confirm");
      } else {
        resetInteractive();
      }
      render();
    },
    showToast(text, kind) {
      toast.className = `toast ${kind}`;
      toast.textContent = text;
      toast.hidden = false;
      // 强制回流以触发过渡动画
      void toast.offsetWidth;
      toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => { toast.hidden = true; }, 200);
      }, 3000);
    },
    destroy() {
      if (toastTimer) clearTimeout(toastTimer);
      host.remove();
    },
  };
}
