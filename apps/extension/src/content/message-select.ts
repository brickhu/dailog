// 采集确认态勾选框：每条已采集消息体右上角注入 checkbox（默认勾选），
// 用户取消勾选 = 剔除该条；确认导入时按勾选状态过滤。
// 勾选状态按消息索引持久——虚拟列表（chatgpt 等）滚动/渲染会重建消息
// DOM 导致挂载的 checkbox 被回收，refreshSelects 定期重建并恢复勾选态。
// 本地解析器/规则路径的节点均带 el 引用（MessageNode.el）

const CHECKBOX_CLASS = "dailog-select-checkbox";
let boxes = new Map<Element, HTMLInputElement>();
/** 记录注入时改动的消息容器 position（absolute 定位依赖），清除时还原 */
let prevPositions = new Map<Element, string>();
/** 按消息索引持久勾选状态（重建 checkbox 时恢复） */
let checkedByIndex = new Map<number, boolean>();

function makeCheckbox(el: HTMLElement): HTMLInputElement {
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
  return cb;
}

/** 给消息节点注入勾选框（默认全部勾选；幂等——先清除旧的） */
export function renderSelects(nodes: Array<{ el?: Element }>): void {
  clearSelects();
  nodes.forEach((n, i) => {
    if (!n.el) return;
    const cb = makeCheckbox(n.el as HTMLElement);
    cb.checked = checkedByIndex.get(i) ?? true;
    cb.addEventListener("change", () => checkedByIndex.set(i, cb.checked));
  });
}

/** 重建被页面（虚拟列表渲染）移除的勾选框，保留已勾选状态。
 *  确认态期间定期调用——消息 DOM 被重建后选框不消失 */
export function refreshSelects(nodes: Array<{ el?: Element }>): void {
  nodes.forEach((n, i) => {
    if (!n.el) return;
    const el = n.el as HTMLElement;
    if (el.querySelector(`input.${CHECKBOX_CLASS}`)) return; // 还在
    const cb = makeCheckbox(el);
    cb.checked = checkedByIndex.get(i) ?? true;
    cb.addEventListener("change", () => checkedByIndex.set(i, cb.checked));
  });
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
  checkedByIndex.clear();
}
