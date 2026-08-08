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

/** 消息稳定键：data-message-id / 内容哈希等稳定 id 直接用；序列派生 id
 *  （rule-/gen-N，虚拟列表窗口下标不可靠）→ role+content 内容键 */
export function messageKey(n: { id: string; role: "user" | "assistant"; content: string }): string {
  return /^(rule|gen)-\d+$/.test(n.id) ? `${n.role}\u0000${n.content}` : n.id;
}

/** 问答单元（一问一答的 DOM 父级容器语义——动态分组，不依赖平台选择器）：
 *  从 user 消息开始，到下一个 user 消息前结束（中间的 assistant 归属该单元）；
 *  assistant 开头的片段单独成组（窗口切分，几何归属由调用方按成员匹配） */
export interface QaUnit {
  /** 单元标识：首个消息的稳定键（片段 = 首个 assistant 的键） */
  id: string;
  /** 单元内消息（文档序） */
  messages: MessageNode[];
}

export function groupIntoUnits(nodes: MessageNode[]): QaUnit[] {
  const units: QaUnit[] = [];
  for (const n of nodes) {
    const last = units[units.length - 1];
    if (n.role === "user" || !last) {
      units.push({ id: messageKey(n), messages: [n] });
    } else {
      last.messages.push(n);
    }
  }
  return units;
}

/** 问答单元的当前视口几何（成员消息 rect 的并集；虚拟列表回收的元素 rect 归零，
 *  由仍渲染的成员决定——向下滚时单元重新渲染，几何保持新鲜） */
export function unitRect(unit: QaUnit): { top: number; bottom: number } {
  const tops = unit.messages.map((m) => m.el?.getBoundingClientRect().top ?? 0);
  const bottoms = unit.messages.map((m) => m.el?.getBoundingClientRect().bottom ?? 0);
  return { top: Math.min(...tops), bottom: Math.max(...bottoms) };
}

/** 扫码采集的视窗可见性判定（方向修正：向上滚 = 内容在视窗中下移，消息进入
 *  视窗即选中；完全滚出视窗上方 = 向下滚滚过 = 取消；滚出视窗下方 = 向上滚
 *  滚过 = 保留——到顶时全部保留） */
export type UnitVisibility = "visible" | "above" | "below";

export function unitVisibility(top: number, bottom: number, viewportHeight: number): UnitVisibility {
  if (bottom < 0) return "above"; // 完全滚出视窗上方（向下滚取消）
  if (top >= viewportHeight) return "below"; // 完全滚出视窗下方（向上滚保留）
  return "visible";
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
