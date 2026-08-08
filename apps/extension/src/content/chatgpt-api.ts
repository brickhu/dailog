// ChatGPT 官方 API 采集（免滚动）：/backend-api/conversation/{id} 返回完整
// 对话（mapping 节点图）。需 Authorization: Bearer <accessToken>——
// token 在 localStorage __session 里（content script 可读，同源共享）。
// 失败（未登录/token 结构变化）→ null，回退 DOM 采集。

import type { CollectedDialogue } from "../shared";

/** 从 localStorage __session 读取 accessToken（JSON 或含 accessToken 字段的对象） */
export function getChatgptAccessToken(): string | null {
  try {
    const raw = localStorage.getItem("__session");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" && parsed.length > 0) return parsed;
    if (typeof parsed?.accessToken === "string" && parsed.accessToken.length > 0) return parsed.accessToken;
    return null;
  } catch {
    return null;
  }
}

export interface ChatgptNode {
  message?: {
    author?: { role?: string };
    content?: { parts?: unknown[] };
  };
  children?: string[];
}

export interface ChatgptConversation {
  title?: string;
  mapping?: Record<string, ChatgptNode>;
}

/** 拉取对话详情 → dialogue。
 *  mapping 是节点图：message 为空的节点是根；从根沿 children 深度优先
 *  遍历即对话顺序；parts 为文本数组（含代码等），拼接为消息内容 */
export async function fetchChatgptConversation(id: string): Promise<CollectedDialogue | null> {
  const token = getChatgptAccessToken();
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`/backend-api/conversation/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let d: ChatgptConversation;
  try {
    d = (await res.json()) as ChatgptConversation;
  } catch {
    return null;
  }
  const mapping = d.mapping ?? {};
  // 找根节点：无 message（或 parent 缺失）的节点
  const rootId = Object.keys(mapping).find((k) => !mapping[k]?.message);
  if (!rootId) return null;
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const visit = (nodeId: string): void => {
    const node = mapping[nodeId];
    if (!node) return;
    const role = node.message?.author?.role;
    if (role === "user" || role === "assistant") {
      const parts = (node.message?.content?.parts ?? []).filter((p): p is string => typeof p === "string");
      const content = parts.join("\n\n");
      if (content) messages.push({ role, content });
    }
    for (const c of node.children ?? []) visit(c);
  };
  visit(rootId);
  if (messages.length === 0 || !messages.some((m) => m.role === "assistant")) return null;
  return {
    platform: "chatgpt",
    conversationId: id,
    title: typeof d.title === "string" && d.title ? d.title : "ChatGPT 对话",
    url: `https://chatgpt.com/c/${id}`,
    messages,
  };
}
