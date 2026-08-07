// 采集确认态勾选框：每条已采集消息体右上角注入 checkbox（默认勾选），
// 用户取消勾选 = 剔除该条；确认导入时按勾选状态过滤。
// 本地解析器/规则路径的节点均带 el 引用（MessageNode.el）

const CHECKBOX_CLASS = "dailog-select-checkbox";
let boxes = new Map<Element, HTMLInputElement>();
/** 记录注入时改动的消息容器 position（absolute 定位依赖），清除时还原 */
let prevPositions = new Map<Element, string>();

/** 给消息节点注入勾选框（默认全部勾选；幂等——先清除旧的）。
 *  容器若无定位则临时设 relative（checkbox absolute 右上角），清除时还原 */
export function renderSelects(nodes: Array<{ el?: Element }>): void {
  clearSelects();
  for (const n of nodes) {
    if (!n.el) continue;
    const el = n.el as HTMLElement;
    // 容器无显式定位（默认 static）→ 临时设 relative（checkbox absolute 定位依赖）；
    // 检查 inline style 而非 getComputedStyle（jsdom 与浏览器默认值行为一致）
    if (!el.style.position || el.style.position === "static") {
      prevPositions.set(el, el.style.position);
      el.style.position = "relative";
    }
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.className = CHECKBOX_CLASS;
    cb.setAttribute("aria-label", "选择此条消息");
    cb.style.cssText = [
      "position:absolute",
      "top:6px",
      "right:6px",
      "z-index:2147483646",
      "width:16px",
      "height:16px",
      "margin:0",
      "cursor:pointer",
      "accent-color:#22c55e",
      "pointer-events:auto",
    ].join(";");
    el.appendChild(cb);
    boxes.set(el, cb);
  }
}

/** 按原顺序返回勾选中的节点（未注入勾选框的节点视为保留——保持兼容） */
export function selectedNodes<T extends { el?: Element }>(nodes: T[]): T[] {
  return nodes.filter((n) => !n.el || boxes.get(n.el)?.checked !== false);
}

/** 移除全部勾选框并还原容器定位（幂等） */
export function clearSelects(): void {
  for (const cb of boxes.values()) cb.remove();
  boxes.clear();
  for (const [el, prev] of prevPositions) (el as HTMLElement).style.position = prev;
  prevPositions.clear();
}
