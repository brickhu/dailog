// 采集确认面板：采集完成后的消息选择 UI（Shadow DOM 独立面板）。
// 数据来自内存中的消息节点（MessageNode[]），不依赖页面消息 DOM——
// 虚拟列表只渲染视口窗口、渲染会重建元素，页面内勾选框不可持续；
// 面板全量列出消息供勾选，与虚拟列表无关。

import type { MessageNode } from "./core";

export interface ConfirmPanelOptions {
  onConfirm: (selected: MessageNode[]) => void;
  onAbandon: () => void;
}

export interface ConfirmPanel {
  open(nodes: MessageNode[], opts: ConfirmPanelOptions): void;
  close(): void;
  isOpen(): boolean;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel {
  position: fixed; right: 24px; bottom: 84px; z-index: 2147483646;
  width: 340px; max-height: 55vh; display: flex; flex-direction: column;
  background: #fff; border-radius: 14px; box-shadow: 0 8px 32px rgba(15, 23, 42, 0.25);
  border: 1px solid #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
  overflow: hidden;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  font-size: 14px; font-weight: 600; color: #0f172a;
}
.header .hint { font-size: 12px; font-weight: 400; color: #64748b; }
.list { overflow-y: auto; padding: 8px; flex: 1; }
.row {
  display: flex; align-items: flex-start; gap: 8px; padding: 7px 8px;
  border-radius: 8px; cursor: pointer; font-size: 12px; color: #334155;
}
.row:hover { background: #f1f5f9; }
.row input { margin-top: 2px; accent-color: #22c55e; width: 14px; height: 14px; flex-shrink: 0; }
.row .role {
  flex-shrink: 0; font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
}
.row .role.user { background: #dcfce7; color: #166534; }
.row .role.assistant { background: #dbeafe; color: #1e40af; }
.row .text { flex: 1; line-height: 1.4; word-break: break-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.empty { padding: 24px; text-align: center; color: #94a3b8; font-size: 13px; }
.footer { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #e2e8f0; background: #f8fafc; }
button {
  flex: 1; padding: 9px 12px; border: none; border-radius: 999px; cursor: pointer;
  font-size: 13px; font-weight: 600;
}
button.confirm { background: #16a34a; color: #fff; }
button.confirm:disabled { background: #bbf7d0; color: #86efac; cursor: default; }
button.abandon { background: transparent; color: #64748b; border: 1px solid #cbd5e1; }
button.abandon:hover { background: #f1f5f9; }
`;

export function createConfirmPanel(): ConfirmPanel {
  // 幂等：重复初始化（内容脚本重注入/测试多实例）先移除旧宿主，避免面板叠加
  document.querySelector("[dailog-panel]")?.remove();
  const host = document.createElement("div");
  host.setAttribute("dailog-panel", ""); // 可识别标记（测试/调试经 shadowRoot 查询）
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;

  const header = document.createElement("div");
  header.className = "header";
  const title = document.createElement("span");
  const hint = document.createElement("span");
  hint.className = "hint";
  header.append(title, hint);

  const list = document.createElement("div");
  list.className = "list";

  const footer = document.createElement("div");
  footer.className = "footer";
  const abandonBtn = document.createElement("button");
  abandonBtn.className = "abandon";
  abandonBtn.textContent = "放弃";
  const confirmBtn = document.createElement("button");
  confirmBtn.className = "confirm";
  confirmBtn.textContent = "确认导入";
  footer.append(abandonBtn, confirmBtn);

  panel.append(header, list, footer);
  shadow.appendChild(panel);
  document.documentElement.appendChild(host);

  let nodes: MessageNode[] = [];
  let checked = new Map<number, boolean>();
  let opts: ConfirmPanelOptions | null = null;

  const selected = (): MessageNode[] => nodes.filter((_, i) => checked.get(i) !== false);

  function updateCount(): void {
    confirmBtn.textContent = `确认导入 (${selected().length})`;
    confirmBtn.disabled = selected().length === 0;
  }

  function render(): void {
    title.textContent = `已采集 ${nodes.length} 条消息`;
    hint.textContent = "取消勾选可剔除";
    list.innerHTML = "";
    if (nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "未采集到消息";
      list.appendChild(empty);
    }
    nodes.forEach((n, i) => {
      const row = document.createElement("label");
      row.className = "row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked.get(i) ?? true;
      cb.addEventListener("change", () => {
        checked.set(i, cb.checked);
        updateCount();
      });
      const role = document.createElement("span");
      role.className = `role ${n.role}`;
      role.textContent = n.role === "user" ? "我" : "AI";
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = n.content;
      row.append(cb, role, text);
      list.appendChild(row);
    });
    updateCount();
  }

  abandonBtn.addEventListener("click", () => {
    const cb = opts?.onAbandon;
    close();
    cb?.();
  });
  confirmBtn.addEventListener("click", () => {
    if (selected().length === 0) return;
    const cb = opts?.onConfirm;
    const sel = selected();
    close();
    cb?.(sel);
  });

  function close(): void {
    panel.hidden = true;
    nodes = [];
    checked.clear();
    opts = null;
  }

  return {
    open(nextNodes, nextOpts) {
      nodes = nextNodes;
      checked.clear();
      opts = nextOpts;
      panel.hidden = false;
      render();
    },
    close,
    isOpen: () => !panel.hidden,
  };
}
