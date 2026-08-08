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

/** 问答单元完整性：必须同时有问有答——光有问没有答的不算问答单元
 *  （末尾未回答的追问 / 流式生成中的最后一条不计入） */
export function isCompleteUnit(unit: QaUnit): boolean {
  return unit.messages.some((m) => m.role === "assistant");
}

/** 问答单元的当前视口几何（成员消息 rect 的并集；虚拟列表回收的元素 rect 归零，
 *  由仍渲染的成员决定——向下滚时单元重新渲染，几何保持新鲜） */
export function unitRect(unit: QaUnit): { top: number; bottom: number; left: number; right: number } {
  const tops = unit.messages.map((m) => m.el?.getBoundingClientRect().top ?? 0);
  const bottoms = unit.messages.map((m) => m.el?.getBoundingClientRect().bottom ?? 0);
  const lefts = unit.messages.map((m) => m.el?.getBoundingClientRect().left ?? 0);
  const rights = unit.messages.map((m) => m.el?.getBoundingClientRect().right ?? 0);
  return {
    top: Math.min(...tops),
    bottom: Math.max(...bottoms),
    left: Math.min(...lefts),
    right: Math.max(...rights),
  };
}

/** 合并问答单元成员（稳定键去重、内容只增不减——流式/截断中间态不丢内容；
 *  新成员按 incoming 文档序追加）。选中单元必须完整保留在数组中——
 *  窗口切分读到单元局部时合并而非替换，避免已选内容丢失 */
export function mergeUnitMembers(target: QaUnit, incoming: QaUnit): void {
  for (const m of incoming.messages) {
    const i = target.messages.findIndex((x) => messageKey(x) === messageKey(m));
    if (i >= 0) {
      if (m.content.length > target.messages[i].content.length) target.messages[i] = m;
    } else {
      target.messages.push(m);
    }
  }
}

/** 扫码线穿越判定（问答单元底线相对视窗中线的方向穿越——用户规则）：
 *  - 往上滚：底线从 < 中线 变为 > 中线（底线实际 Y 值跨过中线）→ add（追加到数组）
 *  - 往下滚：底线从 > 中线 变为 < 中线 → remove（从数组移出）
 *  - 首次见到：底线已在中线以下（> 中线）→ add（起点底部单元默认选中）；
 *    底线在中线以上 → none（尚未扫过）
 *  滚到顶时顶部短单元静止在中线上方，但从未向下穿越 → 保留（不误删） */
export type ScanCrossing = "add" | "remove" | "none";

export function scanCrossing(prevBottom: number | undefined, bottom: number, centerY: number): ScanCrossing {
  if (prevBottom === undefined) return bottom > centerY ? "add" : "none";
  if (prevBottom <= centerY && bottom > centerY) return "add"; // 向上穿越（往上滚）
  if (prevBottom >= centerY && bottom < centerY) return "remove"; // 向下穿越（往下滚）
  return "none";
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
