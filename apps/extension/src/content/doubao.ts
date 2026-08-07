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

/** doubao 消息文本：克隆并移除嵌套的消息子树（真实页面消息容器逐轮嵌套——
 *  外层 turn 容器包含后续所有轮次，直接全量提取会把整段对话重复进去；
 *  等价于旧版 contentSelector 取「第一个内容块」的语义，但不受类名漂移影响） */
function messageContent(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(MESSAGE_SELECTOR).forEach((n) => n.remove());
  return messageText(clone);
}

/** doubao 对话页解析（用户滚动驱动渲染，轮询读当前渲染出的消息） */
export function parseDoubaoPage(root: ParentNode): MessageNode[] {
  const nodes: MessageNode[] = [];
  root.querySelectorAll(MESSAGE_SELECTOR).forEach((el, i) => {
    let role: Role | null = null;
    if (el.matches(USER_SELECTOR)) role = "user";
    else if (el.matches(ASSISTANT_SELECTOR)) role = "assistant";
    if (!role) return;
    const content = messageContent(el);
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
