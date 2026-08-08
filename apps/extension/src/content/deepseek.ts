import type { MessageNode } from "./core";
import { messageText } from "./core";
import type { CollectedDialogue, Role } from "../shared";

// 新版结构（2026-08-07 实测）：data-message-author-role 已移除；
// 消息容器 div.ds-message（user/assistant 共用），assistant 内容带语义类
// ds-assistant-message-main-content，user 内容为 ds-message 的直接子 div。
// user 判定沿用 parseByRule 的容器规则：ds-message 内嵌套 assistant 内容 → 由内层承接
const ASSISTANT_SELECTOR = ".ds-assistant-message-main-content";
const USER_SELECTOR = "div.ds-message";
const MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;

/** 稳定消息 id：优先节点自身，其次向上找 ds-message 容器（assistant 内容节点
 *  挂载在语义类上，data-message-id 在容器上），缺省按读取序号派生 */
export function deepseekMessageId(el: Element, index: number): string {
  return (
    el.getAttribute("data-message-id") ??
    el.closest(".ds-message")?.getAttribute("data-message-id") ??
    `gen-${index}`
  );
}

/** DeepSeek 对话页解析（虚拟列表存活节点；打印撑开/滚动下全量提取） */
export function parseDeepSeekPage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el, i) => {
    let role: Role | null = null;
    if (el.matches(USER_SELECTOR) && !el.querySelector(ASSISTANT_SELECTOR)) role = "user";
    else if (el.matches(ASSISTANT_SELECTOR)) role = "assistant";
    if (!role) return;
    const content = messageText(el);
    if (!content) return;
    nodes.push({
      id: deepseekMessageId(el, i),
      offsetTop: el.getBoundingClientRect().top,
      role,
      content,
      el,
    });
  });
  return nodes;
}

/** 新版对话页 /a/chat/s/{uuid}（2026-08-07 实测）；兼容旧格式 /chat/{id} */
export function deepseekConversationId(url: string): string | null {
  return url.match(/\/a\/chat\/s\/([^/?#]+)/)?.[1] ?? url.match(/\/chat\/([^/?#]+)/)?.[1] ?? null;
}

/** deepseek 分享页数据解析（/api/v0/share/content 响应）：
 *  data.biz_data.messages[] → role/content（thinking_content 不并入） */
export function parseDeepSeekShare(
  d: { data?: { biz_data?: { messages?: Array<{ role?: string; content?: string }> } } },
  id: string,
  url: string,
): CollectedDialogue | null {
  const msgs = d?.data?.biz_data?.messages ?? [];
  const messages = msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role === "user" ? ("user" as const) : ("assistant" as const), content: m.content ?? "" }))
    .filter((m) => m.content);
  if (messages.length === 0) return null;
  return { platform: "deepseek", conversationId: id, title: "DeepSeek 分享对话", url, messages };
}

export function collectDeepSeek(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = deepseekConversationId(url);
  if (!conversationId) return null;
  const messages = parseDeepSeekPage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (root.ownerDocument?.title ?? "").replace(/\s*[-·]\s*DeepSeek\s*$/, "").trim();
  return { platform: "deepseek", conversationId, title, url, messages };
}
