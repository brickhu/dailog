import { normalizeMessageText } from "../shared";

export interface MessageNode {
  id: string;          // 消息唯一标识（DOM id / data-message-id / 生成）
  offsetTop: number;   // 容器内排序依据
  role: "user" | "assistant";
  content: string;
  /** DOM 引用（本地解析器填充）——采集进度高亮用；规则兜底节点无此字段 */
  el?: Element;
}

/** 按 id 去重、按 offsetTop 升序 */
export function dedupeSort(nodes: MessageNode[]): MessageNode[] {
  const seen = new Set<string>();
  const unique: MessageNode[] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  return unique.sort((a, b) => a.offsetTop - b.offsetTop);
}

/** 手动采集合并：按 id 替换（最新读数覆盖旧内容/位置）或追加，
 *  保持首见顺序（用户自上而下滚动 = 对话顺序，offsetTop 是视口相对值、
 *  跨轮无意义，故不做排序） */
export function mergeMessageNodes(acc: MessageNode[], nodes: MessageNode[]): void {
  for (const n of nodes) {
    const idx = acc.findIndex((x) => x.id === n.id);
    if (idx >= 0) acc[idx] = n;
    else acc.push(n);
  }
}

/** 渲染文本提取（= 用户全选该消息拿到的文本）：对元素建 Range 选区读
 *  toString()——浏览器按布局输出可见文本，hidden/sr-only/按钮图标等
 *  噪音天然排除；空串（无 Range 环境等）时 textContent 兜底 */
export function messageText(el: Element): string {
  let text = "";
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    text = range.toString();
  } catch {
    // 无 Range 环境静默
  }
  if (!text) text = el.textContent ?? "";
  return normalizeMessageText(text);
}
