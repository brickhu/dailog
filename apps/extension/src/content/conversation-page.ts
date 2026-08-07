// 对话页判定：content script 按域名全站注入后，非对话页（如 claude.ai 首页）隐藏按钮。
// 远程规则 url.conversationPath 优先（平台改对话路径无需发扩展版本），
// 无规则/未覆盖该平台时回退内置默认表
import type { CollectRule } from "../shared";

// 默认表：claude/deepseek/kimi/doubao 对话页为 /chat/、chatgpt /c/、gemini /app/；
// 无条目平台（tongyi 全站、未知域名）维持「注入即显示」
const DEFAULT_CONVERSATION_PATHS: Record<string, string> = {
  "claude.ai": "/chat/",
  "chat.deepseek.com": "/chat/",
  "chatgpt.com": "/c/",
  "gemini.google.com": "/app/",
  "kimi.moonshot.cn": "/chat/",
  "www.doubao.com": "/chat/",
};

export function isConversationPage(url: string, rule?: CollectRule): boolean {
  const { hostname, pathname } = new URL(url);
  const path = rule?.url?.conversationPath ?? DEFAULT_CONVERSATION_PATHS[hostname];
  return !path || pathname.startsWith(path);
}
