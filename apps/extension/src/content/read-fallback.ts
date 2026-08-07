// 采集提取器的规则兜底：本地专有解析器匹配不到（站点 DOM 改版）时，
// 用远程规则选择器在同一文档上提取。滚动扫描逐窗口渲染后一次到位，
// 避免掉到整页文本兜底（含导航噪音）
import type { CollectRule } from "../shared";
import type { MessageNode } from "./core";
import { parseByRuleWithEl } from "./rule-parser";

/** 本地解析器有结果 → 直接用；为空且规则存在 → 规则选择器兜底提取（带 el 引用，
 *  确认态勾选框可用）。id 用规则序号（规则提取无 DOM id，去重按序号即可——
 *  滚动扫描下文档序稳定） */
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
    id: `rule-${i}`,
    offsetTop: i,
    role: m.role,
    content: m.content,
    el: m.el,
  }));
}
