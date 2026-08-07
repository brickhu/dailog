// 通用选择器解析器：按远程规则（collect-rules.json）解析对话页。
// 用途：本地专有解析器失败（站点改版等）时的 fallback；
// chatgpt/doubao 等无专有解析器的平台，规则就是它们的首选采集路径。

import type { CollectRule, DialogueMessage, Role } from "../shared";
import { normalizeMessageText } from "../shared";

/** 带 DOM 引用的规则解析结果（确认态勾选框需要挂载点；parseByRule 剥离后对外） */
export interface RuleMessage extends DialogueMessage {
  el: Element;
}

/** 按规则解析消息（选择器驱动；带 el 引用）。
 *  messageSelector = 消息作用域容器（缺省 = 整页）；user/assistant 选择器在其内匹配 */
export function parseByRuleWithEl(root: ParentNode, rule: CollectRule): RuleMessage[] | null {
  const { userSelector, assistantSelector, messageSelector, contentSelector } = rule;
  if (!userSelector || !assistantSelector) return null;
  const scopes = messageSelector ? Array.from(root.querySelectorAll(messageSelector)) : [root];
  const messages: RuleMessage[] = [];
  for (const scope of scopes) {
    for (const el of Array.from(scope.querySelectorAll(`${userSelector}, ${assistantSelector}`))) {
      let role: Role | null = null;
      // user 节点若嵌套包含 assistant 匹配（容器型 userSelector 命中 assistant 外层容器，
      // 如 deepseek 新版 div.ds-message 同时包住两种角色）→ 不作为 user，由内层 assistant 节点承接
      if (el.matches(userSelector) && !el.querySelector(assistantSelector)) role = "user";
      else if (el.matches(assistantSelector)) role = "assistant";
      if (!role) continue;
      // 取文本子节点（如 .ds-markdown/.markdown）；无则回退节点自身（user 消息通常没有）
      const target = contentSelector ? (el.querySelector(contentSelector) ?? el) : el;
      const content = normalizeMessageText(target.textContent ?? "");
      if (!content) continue;
      messages.push({ role, content, el });
    }
  }
  return messages.length > 0 ? messages : null;
}

/** 按规则解析消息（对外无 el；采集协议用） */
export function parseByRule(root: ParentNode, rule: CollectRule): DialogueMessage[] | null {
  const msgs = parseByRuleWithEl(root, rule);
  return msgs ? msgs.map(({ role, content }) => ({ role, content })) : null;
}
