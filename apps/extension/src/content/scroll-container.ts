// 消息滚动容器探测：从消息元素向上找第一个 overflow 可滚容器。
// 覆盖平台消息标记并集（claude 新版 role=article 等；无固定容器类名时泛化探测），
// 找不到回退页面级滚动。统一滚动扫描（scrollSweep）依赖正确的容器——
// 容器找错（如页面级兜底）会导致滚动无效、只采视口内消息

/** 消息标记并集（本地解析器/规则的语义标记；新增平台在此登记） */
const MESSAGE_HINTS = [
  "[data-testid='user-message']", // claude 旧版
  "[data-testid='assistant-message']",
  "[data-message-author-role]", // chatgpt / doubao / deepseek 旧版
  ".ds-message", // deepseek 新版
  "div[role='article']", // claude 新版消息作用域
].join(", ");

/** 收集全部候选滚动容器（从内到外）：
 *  1. 平台专有容器（如 deepseek .ds-scroll-area）
 *  2. 消息祖先链中的 overflow 可滚容器
 *  3. Virtuoso 标准 scroller 属性（claude 等）
 *  4. 页面级滚动
 *  受控虚拟列表可能重置单一容器的 scrollTop——sweep 对全部候选滚动，
 *  真正的 scroller 一定在其中 */
export function collectScrollContainers(root: ParentNode, hints?: string[]): HTMLElement[] {
  const set = new Set<HTMLElement>();
  // 1. 平台专有容器
  for (const sel of hints ?? []) {
    root.querySelectorAll(sel).forEach((el) => set.add(el as HTMLElement));
  }
  // 2. 消息祖先链 overflow 容器（消息内部的小容器也可能命中，靠 sweep 全滚覆盖）
  const first = root.querySelector(MESSAGE_HINTS);
  let el: HTMLElement | null = (first?.parentElement as HTMLElement | null) ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") set.add(el);
    el = el.parentElement;
  }
  // 3. Virtuoso 标准 scroller 属性
  root.querySelectorAll("[data-virtuoso-scroller]").forEach((el) => set.add(el as HTMLElement));
  // 4. 页面级滚动
  const doc = (root as Document).ownerDocument ?? (root as Document);
  const page = (doc.scrollingElement ?? doc.documentElement) as HTMLElement | null;
  if (page) set.add(page);
  return [...set];
}

/** 找消息区域的可滚动容器：在消息祖先链中选 scrollHeight 最大的 overflow 容器
 *  （真正的消息滚动区最大；消息内部的小 overflow 容器如代码块、折叠面板会被排除）。
 *  注意：虚拟列表容器 scrollHeight≈clientHeight（只渲染视口窗口），
 *  不能要求有滚动余量——只要 overflow 可滚就参与候选 */
export function findScrollContainer(root: ParentNode): HTMLElement | null {
  const first = root.querySelector(MESSAGE_HINTS);
  let el: HTMLElement | null = (first?.parentElement as HTMLElement | null) ?? null;
  let best: HTMLElement | null = null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") {
      if (!best || el.scrollHeight > best.scrollHeight) best = el;
    }
    el = el.parentElement;
  }
  // 兜底：页面级滚动（Document 自身 ownerDocument 为 null；scrollingElement
  // 缺省时 documentElement——DOMParser 文档等环境）
  const doc = (root as Document).ownerDocument ?? (root as Document);
  return best ?? ((doc.scrollingElement ?? doc.documentElement) as HTMLElement | null);
}
