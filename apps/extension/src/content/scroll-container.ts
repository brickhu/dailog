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

/** 找消息区域向上第一个可滚动容器。
 *  注意：虚拟列表容器 scrollHeight≈clientHeight（只渲染视口窗口），
 *  不能要求有滚动余量——只要 overflow 可滚就认 */
export function findScrollContainer(root: ParentNode): HTMLElement | null {
  const first = root.querySelector(MESSAGE_HINTS);
  let el: HTMLElement | null = (first?.parentElement as HTMLElement | null) ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return el;
    el = el.parentElement;
  }
  // 兜底：页面级滚动（Document 自身 ownerDocument 为 null；scrollingElement
  // 缺省时 documentElement——DOMParser 文档等环境）
  const doc = (root as Document).ownerDocument ?? (root as Document);
  return (doc.scrollingElement ?? doc.documentElement) as HTMLElement | null;
}
