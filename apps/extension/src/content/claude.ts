import type { MessageNode } from "./core";
import type { CollectedDialogue } from "../shared";

const USER_SELECTOR = '[data-testid="user-message"]';
const ASSISTANT_SELECTOR = '[data-testid="assistant-message"]';

/** 从消息节点提取纯文本内容（剥离隐藏节点、代码块保留文本） */
function extractText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

const MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;

/** Claude 对话页解析（选择器依据 docs/spikes/chat-dom.md，待真实页面校准） */
export function parseClaudePage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  // 单次 querySelectorAll 按文档序收集，保证 jsdom（offsetTop 恒 0，sort 退化为插入序）
  // 与真实浏览器（offsetTop 不同，sort 修正顺序）下均按对话先后输出。
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el) => {
    const role = el.matches(USER_SELECTOR) ? "user" : "assistant";
    nodes.push({ id: `${role === "user" ? "u" : "a"}-${nodes.length}`, offsetTop: el.getBoundingClientRect().top, role, content: extractText(el) });
  });
  return nodes.sort((a, b) => a.offsetTop - b.offsetTop);
}

/** 从 URL 提取 conversationId（claude.ai/chat/{uuid}） */
export function claudeConversationId(url: string): string | null {
  return url.match(/\/chat\/([a-f0-9-]+)/)?.[1] ?? null;
}

/** 组装采集协议（title 取 document.title，去掉平台后缀） */
export function collectClaude(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = claudeConversationId(url);
  if (!conversationId) return null;
  const messages = parseClaudePage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (root.ownerDocument?.title ?? "").replace(/\s*[·|]\s*Claude\s*$/, "").trim();
  return { platform: "claude", conversationId, title, url, messages };
}
