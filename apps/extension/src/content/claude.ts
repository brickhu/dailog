import type { MessageNode } from "./core";
import type { CollectedDialogue, Role } from "../shared";
import { normalizeMessageText } from "../shared";
import { extractTitle } from "./title";

const USER_SELECTOR = '[data-testid="user-message"]';
const ASSISTANT_SELECTOR = '[data-testid="assistant-message"]';

/** 从消息节点提取文本（保真规范化：保留换行/代码缩进） */
function extractText(el: Element): string {
  return normalizeMessageText(el.textContent ?? "");
}

const MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;

/** 稳定消息 id：内容哈希（滚动采集时历史消息插到顶部，基于位置的序号会变——去重失效） */
function messageId(role: Role, content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) h = (h * 31 + content.charCodeAt(i)) >>> 0;
  return `${role === "user" ? "u" : "a"}-${h.toString(36)}`;
}

/** Claude 对话页解析（选择器依据 docs/spikes/chat-dom.md，待真实页面校准） */
export function parseClaudePage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  // 单次 querySelectorAll 按文档序收集，保证 jsdom（offsetTop 恒 0，sort 退化为插入序）
  // 与真实浏览器（offsetTop 不同，sort 修正顺序）下均按对话先后输出。
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el) => {
    const role = el.matches(USER_SELECTOR) ? "user" : "assistant";
    const content = extractText(el);
    nodes.push({ id: messageId(role, content), offsetTop: el.getBoundingClientRect().top, role, content, el });
  });
  return nodes.sort((a, b) => a.offsetTop - b.offsetTop);
}

/** 从 URL 提取 conversationId（claude.ai/chat/{uuid}） */
export function claudeConversationId(url: string): string | null {
  return url.match(/\/chat\/([a-f0-9-]+)/)?.[1] ?? null;
}

/** 组装采集协议（title：DOM 对话标题 → document.title → 首条用户消息摘要） */
export function collectClaude(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = claudeConversationId(url);
  if (!conversationId) return null;
  const messages = parseClaudePage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = extractTitle(root, messages);
  return { platform: "claude", conversationId, title, url, messages };
}
