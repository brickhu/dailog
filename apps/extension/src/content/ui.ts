// 浮动采集按钮 UI：Shadow DOM 隔离样式，避免被页面 CSS 污染

export interface FabController {
  setBusy(busy: boolean): void;
  showToast(text: string, kind: "success" | "error"): void;
  /** 未登录时展开登录引导面板（点"去登录"打开统一登录页，登录后回跳当前页） */
  showLoginPanel(loginUrl: string): void;
  closeLoginPanel(): void;
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
@keyframes pulse { 50% { opacity: 0.3; } }
.toast {
  max-width: 260px; padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.4;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15); opacity: 0; transform: translateY(4px);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast.show { opacity: 1; transform: translateY(0); }
.toast.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
.toast.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.panel {
  display: none; width: 240px; padding: 14px 16px; border-radius: 12px;
  background: #fff; color: #0f172a; border: 1px solid #e2e8f0;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
}
.panel.show { display: block; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.panel-title { font-size: 13px; font-weight: 700; }
.panel-close { border: none; background: none; cursor: pointer; color: #94a3b8; font-size: 14px; line-height: 1; }
.panel-desc { font-size: 12px; color: #64748b; line-height: 1.5; margin-bottom: 10px; }
.panel-btn {
  width: 100%; padding: 8px 0; border: none; border-radius: 8px; cursor: pointer;
  background: #0f172a; color: #fff; font-size: 13px; font-weight: 600;
}
.panel-btn:hover { background: #1e293b; }
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

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-head">
      <span class="panel-title">需要登录 dailog</span>
      <button class="panel-close" type="button" aria-label="关闭">✕</button>
    </div>
    <div class="panel-desc">登录后即可采集当前对话，并自动同步到你的工作台。</div>
    <button class="panel-btn" type="button">去登录</button>
  `;
  panel.querySelector(".panel-close")!.addEventListener("click", () => {
    panel.classList.remove("show");
  });
  wrap.appendChild(panel);

  const fab = document.createElement("button");
  fab.className = "fab";
  fab.type = "button";
  fab.innerHTML = '<span class="dot"></span><span>采集对话</span>';
  fab.addEventListener("click", opts.onClick);
  wrap.appendChild(fab);

  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    setBusy(busy) {
      fab.disabled = busy;
      fab.classList.toggle("busy", busy);
      fab.querySelector("span:last-child")!.textContent = busy ? "采集中…" : "采集对话";
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
    showLoginPanel(loginUrl) {
      panel.querySelector(".panel-btn")!.addEventListener("click", () => {
        // 用户手势内 window.open：允许新标签打开登录页（登录后 redirect 回当前对话页）
        window.open(loginUrl, "_blank");
        panel.classList.remove("show");
      });
      panel.classList.add("show");
    },
    closeLoginPanel() {
      panel.classList.remove("show");
    },
    destroy() {
      if (toastTimer) clearTimeout(toastTimer);
      host.remove();
    },
  };
}
