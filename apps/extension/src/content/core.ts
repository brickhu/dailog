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

/** 步进截取合并（自下而上）：新节点一律位于已采内容上方 → 前插；
 *  同 id 替换（最新读数覆盖旧内容/位置）。最终顺序 = 对话顺序（顶 → 底）。
 *  不可靠的序号派生 id（rule-/gen-N——虚拟列表窗口下标会变，同一条消息在
 *  不同窗口的序号不同）→ 按 (role + content) 内容键合并，跨窗口才能累积。
 *  降级保护（"变绿就要获取"）：新内容为旧内容的严格前缀（骨架/截断重渲染）
 *  → 保留更完整的旧内容，不丢已捕获信息 */
export function mergeMessageNodes(acc: MessageNode[], nodes: MessageNode[]): void {
  const prepend: MessageNode[] = [];
  for (const n of nodes) {
    const seq = /^(rule|gen)-\d+$/.test(n.id);
    const idx = seq
      ? acc.findIndex((x) => /^(rule|gen)-\d+$/.test(x.id) && x.role === n.role && x.content === n.content)
      : acc.findIndex((x) => x.id === n.id);
    if (idx >= 0) {
      const old = acc[idx].content;
      if (old.length > n.content.length && old.startsWith(n.content)) continue; // 截断降级 → 保留完整版
      acc[idx] = n;
    } else {
      prepend.push(n);
    }
  }
  if (prepend.length > 0) acc.unshift(...prepend);
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
