// 问答单元选区框：为每个已选单元画一个绿色边框矩形，框住整个问答单元
// （一问一答的容器范围）——不修改页面 DOM 结构（虚拟列表对包裹/加类敏感），
// 用 position:fixed 浮层矩形跟随单元几何，滚动时每轮刷新。

import { unitRect, type QaUnit } from "./core";

let container: HTMLDivElement | null = null;
const boxes = new Map<string, HTMLDivElement>(); // unitId → 框

const BOX_STYLE = [
  "position:fixed",
  "border:2px solid rgba(74,222,128,0.9)",
  "border-radius:10px",
  "background:rgba(74,222,128,0.06)",
  "pointer-events:none", // 不阻断交互
  "z-index:2147483645",
  "box-sizing:border-box",
].join(";");

function ensureContainer(): HTMLDivElement {
  if (!container?.isConnected) {
    container = document.createElement("div");
    container.setAttribute("dailog-unit-boxes", ""); // 可识别标记（测试/调试）
    document.documentElement.appendChild(container);
  }
  return container;
}

/** 按当前已选单元集渲染选区框（幂等：几何变化更新、取消的移除；滚动时每轮调用） */
export function renderUnitBoxes(units: QaUnit[]): void {
  const root = ensureContainer();
  const seen = new Set<string>();
  for (const unit of units) {
    const { top, bottom, left, right } = unitRect(unit);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) continue; // 无有效几何（成员全部被回收）→ 不画
    seen.add(unit.id);
    let box = boxes.get(unit.id);
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = BOX_STYLE;
      root.appendChild(box);
      boxes.set(unit.id, box);
    }
    box.style.top = `${Math.round(top)}px`;
    box.style.left = `${Math.round(left)}px`;
    box.style.width = `${Math.round(width)}px`;
    box.style.height = `${Math.round(height)}px`;
  }
  // 清理不再选中的框
  for (const [id, box] of boxes) {
    if (!seen.has(id)) {
      box.remove();
      boxes.delete(id);
    }
  }
}

/** 清除全部选区框（采集结束/取消） */
export function clearUnitBoxes(): void {
  for (const box of boxes.values()) box.remove();
  boxes.clear();
  container?.remove();
  container = null;
}
