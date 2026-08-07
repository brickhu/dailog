// studio 页面「待入库」角标 UI：Shadow DOM 隔离样式。
// 数据由 content.ts 轮询注入（setItems）；点条目由 onOpenItem 回调跳 /import?<id>。

import type { CollectSummary } from "../shared";
import { platformLabel, relativeTime } from "../format";

export interface StudioBadgeController {
  /** 更新条目列表（空 → 隐藏角标） */
  setItems(items: CollectSummary[]): void;
  destroy(): void;
}

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap { position: fixed; right: 24px; bottom: 24px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; font-family: system-ui, -apple-system, sans-serif; }
.pill {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: none; border-radius: 999px; cursor: pointer;
  background: #0f172a; color: #fff; font-size: 13px; font-weight: 600;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.35); transition: transform 0.12s ease;
}
.pill:hover { transform: translateY(-1px); }
.pill .count {
  min-width: 20px; padding: 1px 6px; border-radius: 999px;
  background: #f59e0b; color: #fff; font-size: 12px; text-align: center;
}
.panel {
  display: none; width: 280px; max-height: 320px; overflow-y: auto;
  background: #fff; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
}
.panel.show { display: block; }
.panel-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; }
.panel-title { font-size: 13px; font-weight: 700; }
.panel-close { border: none; background: none; cursor: pointer; color: #94a3b8; font-size: 14px; line-height: 1; }
.item {
  display: block; width: 100%; text-align: left; border: none; background: none;
  padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f1f5f9;
}
.item:hover { background: #f8fafc; }
.item:last-child { border-bottom: none; }
.item-title { font-size: 13px; font-weight: 600; line-height: 1.4; margin-bottom: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-meta { font-size: 11px; color: #64748b; }
.empty { padding: 14px; font-size: 12px; color: #94a3b8; text-align: center; }
`;

export function createStudioBadge(opts: { onOpenItem: (collectId: string) => void }): StudioBadgeController {
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="panel-head">
      <span class="panel-title">待入库对话</span>
      <button class="panel-close" type="button" aria-label="关闭">✕</button>
    </div>
    <div class="list"></div>
  `;
  panel.querySelector(".panel-close")!.addEventListener("click", () => panel.classList.remove("show"));
  wrap.appendChild(panel);

  const pill = document.createElement("button");
  pill.className = "pill";
  pill.type = "button";
  pill.innerHTML = '<span class="count">0</span><span>条对话待入库</span>';
  pill.addEventListener("click", () => {
    const showing = panel.classList.contains("show");
    panel.classList.toggle("show", !showing);
  });
  wrap.appendChild(pill);

  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  const listEl = panel.querySelector(".list")!;

  return {
    setItems(items) {
      const count = items.length;
      pill.style.display = count > 0 ? "" : "none";
      if (count === 0) {
        panel.classList.remove("show");
        listEl.innerHTML = "";
        return;
      }
      pill.querySelector(".count")!.textContent = String(count);
      const rows = items.map(
        (item) => `
          <button class="item" type="button" data-id="${item.collectId}">
            <div class="item-title">${escapeHtml(item.title || "未命名对话")}</div>
            <div class="item-meta">${platformLabel(item.platform)} · ${item.messageCount} 条消息 · ${relativeTime(item.createdAt)}</div>
          </button>`,
      ).join("");
      listEl.innerHTML = rows;
      listEl.querySelectorAll<HTMLElement>(".item").forEach((el) => {
        el.addEventListener("click", () => opts.onOpenItem(el.dataset.id!));
      });
    },
    destroy() {
      host.remove();
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
