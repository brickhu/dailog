// 对话标题提取（多平台共用）：
// ① 页面 DOM 中的对话标题元素（claude.ai 等 SPA 的 document.title 不含对话名）
// ② document.title（去平台后缀）
// ③ 首条用户消息摘要（最后兜底，保证标题非空）
import type { Role } from "../shared";

/** 已知的对话标题 DOM 选择器（各平台侧栏标题；命中即用，未命中不报错） */
const TITLE_SELECTORS = [
  '[data-testid="conversation-title"]',
  '[data-testid="chat-title"]',
  '[data-testid="title"]',
];

/** 平台后缀（document.title 形如 "对话标题 · Claude"） */
const SUFFIX_RE = /\s*[·|]\s*(Claude|DeepSeek|ChatGPT|Gemini|Kimi|豆包|通义)\s*$/;

export function extractTitle(root: ParentNode, messages: { role: Role; content: string }[]): string {
  for (const sel of TITLE_SELECTORS) {
    // 防御：测试/异常环境可能传残缺 root（真实页面 ParentNode 必有 querySelector）
    const el = root.querySelector?.(sel) as HTMLElement | null;
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  const doc = (root.ownerDocument?.title ?? "").replace(SUFFIX_RE, "").trim();
  if (doc) return doc;
  const firstUser = messages.find((m) => m.role === "user")?.content.trim();
  if (firstUser) return firstUser.length > 30 ? `${firstUser.slice(0, 30)}…` : firstUser;
  return "";
}
