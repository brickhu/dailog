// doubao 对话页解析（2026-08-07 实测校准，本地解析器——不依赖 CDN 规则）。
// 新版结构：data-message-author-role 不存在；消息容器
// data-target-id="message-box-target-id"，角色由 data-message-id 所在 div 的
// Tailwind 类区分（user=justify-end 右对齐气泡 / assistant=grid 布局）。
// 内容直接提取消息元素渲染文本（messageText = 全选该气泡所见；工具栏/隐藏
// 噪音天然排除，不再依赖 .md-box-root 内容选择器）
import type { MessageNode } from "./core";
import { messageText } from "./core";
import type { CollectedDialogue, Role } from "../shared";

const USER_SELECTOR = "div[data-message-id].justify-end";
const ASSISTANT_SELECTOR = "div[data-message-id].grid";
const MESSAGE_SELECTOR = `${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`;

/** doubao 消息 id：data-message-id（数字 id）；缺省按读取序号派生 */
export function doubaoMessageId(el: Element, index: number): string {
  return el.getAttribute("data-message-id") ?? `gen-${index}`;
}

/** doubao 对话页解析（虚拟列表存活节点；滚动扫描下逐窗口提取） */
export function parseDoubaoPage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el, i) => {
    let role: Role | null = null;
    if (el.matches(USER_SELECTOR)) role = "user";
    else if (el.matches(ASSISTANT_SELECTOR)) role = "assistant";
    if (!role) return;
    const content = messageText(el);
    if (!content) return;
    nodes.push({
      id: doubaoMessageId(el, i),
      offsetTop: el.getBoundingClientRect().top,
      role,
      content,
      el,
    });
  });
  return nodes;
}

/** doubao 对话页 URL 形态（www.doubao.com/chat/{id} 等，末端段即会话 id） */
export function doubaoConversationId(url: string): string | null {
  return url.match(/\/([^/?#]+)\/?$/)?.[1] ?? null;
}

/** doubao 采集（本地解析器；title 用 document.title 去平台后缀） */
export function collectDoubao(root: ParentNode, url: string): CollectedDialogue | null {
  const conversationId = doubaoConversationId(url);
  if (!conversationId) return null;
  const messages = parseDoubaoPage(root).map(({ role, content }) => ({ role, content }));
  if (messages.length === 0) return null;
  const title = (root.ownerDocument?.title ?? "").replace(/\s*[-·]\s*豆包\s*$/, "").trim();
  return { platform: "doubao", conversationId, title, url, messages };
}
