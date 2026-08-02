import type { MessageNode } from "./core";
import type { CollectedDialogue } from "../shared";

const MESSAGE_SELECTOR = '[data-message-author-role="user"], [data-message-author-role="assistant"]';

export function deepseekMessageId(el: Element, index: number): string {
  return el.getAttribute("data-message-id") ?? `gen-${index}`;
}

/** DeepSeek 对话页解析（虚拟列表存活节点；依据 docs/spikes/chat-dom.md，待真实页面校准） */
export function parseDeepSeekPage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el, i) => {
    const role = el.getAttribute("data-message-author-role");
    if (role !== "user" && role !== "assistant") return;
    const content = (el.querySelector(".ds-markdown") ?? el).textContent ?? "";
    nodes.push({
      id: deepseekMessageId(el, i),
      offsetTop: el.getBoundingClientRect().top,
      role,
      content: content.replace(/\s+/g, " ").trim(),
    });
  });
  return nodes;
}

export function deepseekConversationId(url: string): string | null {
  return url.match(/\/chat\/([^/?#]+)/)?.[1] ?? null;
}

export function collectDeepSeek(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = deepseekConversationId(url);
  if (!conversationId) return null;
  const messages = parseDeepSeekPage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (root.ownerDocument?.title ?? "").replace(/\s*[-·]\s*DeepSeek\s*$/, "").trim();
  return { platform: "deepseek", conversationId, title, url, messages };
}
