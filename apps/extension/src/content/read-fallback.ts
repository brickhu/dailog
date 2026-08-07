// 采集提取器的规则兜底：本地专有解析器匹配不到（站点 DOM 改版）时，
// 用远程规则选择器在同一文档上提取。用户滚动驱动渲染，逐窗口提取后按 id 合并，
// 避免掉到整页文本兜底（含导航噪音）
import type { CollectRule } from "../shared";
import type { MessageNode } from "./core";
import { parseByRuleWithEl } from "./rule-parser";

/** 规则节点 id：优先元素自带 data-message-id（chatgpt 等稳定消息 id——跨窗口
 *  不变，合并可靠）；缺省按提取序号派生（虚拟列表窗口下标，不可靠——合并层
 *  按内容键处理） */
export function ruleNodeId(el: Element | undefined, index: number): string {
  return el?.getAttribute("data-message-id") ?? `rule-${index}`;
}

/** 本地解析器有结果 → 直接用；为空且规则存在 → 规则选择器兜底提取（带 el 引用） */
export function applyRuleFallback(
  local: MessageNode[],
  rule: CollectRule | null | undefined,
  root: ParentNode,
): MessageNode[] {
  if (local.length > 0) return local;
  if (!rule) return [];
  const msgs = parseByRuleWithEl(root, rule);
  if (!msgs) return [];
  return msgs.map((m, i) => ({
    id: ruleNodeId(m.el, i),
    offsetTop: i,
    role: m.role,
    content: m.content,
    el: m.el,
  }));
}

/** 本地解析缺助手回复（本地选择器失效，如 claude 新版 DOM 无
 *  data-testid="assistant-message"，本地只匹配到 user）→ 规则提取补齐合并
 *  （同 role + 同 content 去重，不重复叠加） */
export function applyRuleMerge(
  local: MessageNode[],
  rule: CollectRule | null | undefined,
  root: ParentNode,
): MessageNode[] {
  if (!rule) return local;
  const msgs = parseByRuleWithEl(root, rule);
  if (!msgs) return local;
  const out = [...local];
  for (const m of msgs) {
    if (out.some((n) => n.role === m.role && n.content === m.content)) continue;
    out.push({
      id: ruleNodeId(m.el, out.length),
      offsetTop: out.length,
      role: m.role,
      content: m.content,
      el: m.el,
    });
  }
  return out;
}
