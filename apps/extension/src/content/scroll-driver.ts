// 最小化滚动容器探测：优先 data-virtuoso-scroller，其次从消息元素向上找
// 可滚动祖先（scrollHeight > clientHeight），兜底页面级滚动元素。
// （自动滚动由 CDP 真实滚轮事件驱动——background 侧 Input.dispatchMouseEvent；
// 本模块只负责找容器：滚轮落点坐标 + 位置监测）

export function findScrollContainer(root: ParentNode, from?: Element | null): HTMLElement | null {
  const scroller = root.querySelector?.("[data-virtuoso-scroller]");
  if (scroller instanceof HTMLElement) return scroller;
  let el: Element | null = from ?? null;
  while (el) {
    const h = el as HTMLElement;
    if (h.scrollHeight > h.clientHeight + 4) return h;
    el = el.parentElement;
  }
  const se = root.ownerDocument?.scrollingElement;
  return se instanceof HTMLElement && se.scrollHeight > se.clientHeight + 4 ? se : null;
}
