// Claude 官方 API 采集（免滚动）：对话详情接口返回完整结构化消息
// （含附件正文），页面内 fetch 同源带登录 cookie 与 Cloudflare 验证。
// 路径：/api/organizations/{orgId}/chat_conversations/{uuid}

import type { CollectedDialogue } from "../shared";

/** 从页面资源时序中提取组织 id（页面自身请求形如
 *  /api/organizations/{orgId}/...——无需主世界 hook，content script 可直接读） */
export function findOrgIdFromPage(): string | null {
  try {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    for (const e of entries) {
      const m = e.name.match(/\/api\/organizations\/([0-9a-f-]{36})\//);
      if (m) return m[1];
    }
  } catch {
    // 无 performance 环境静默
  }
  return null;
}

export interface ClaudeApiMessage {
  uuid: string;
  text?: string;
  sender?: string; // human = 用户 / assistant = AI
  attachments?: Array<{ file_name?: string; extracted_content?: string }>;
}

/** 拉取对话详情 → 组装 dialogue（sender→role；附件正文追加到消息文本；
 *  失败/无有效消息 → null） */
export async function fetchClaudeConversation(orgId: string, uuid: string): Promise<CollectedDialogue | null> {
  let res: Response;
  try {
    res = await fetch(`/api/organizations/${orgId}/chat_conversations/${uuid}`);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let d: { name?: string; chat_messages?: ClaudeApiMessage[] };
  try {
    d = (await res.json()) as typeof d;
  } catch {
    return null;
  }
  const msgs = Array.isArray(d.chat_messages) ? d.chat_messages : [];
  const messages = msgs
    .filter((m) => m.sender === "human" || m.sender === "assistant")
    .map((m) => {
      // 附件正文（MRD.md 等）追加到消息文本——用户正文常在附件里
      const attach = (m.attachments ?? [])
        .filter((a) => a.extracted_content)
        .map((a) => a.extracted_content)
        .join("\n\n");
      const content = [m.text ?? "", attach].filter(Boolean).join("\n\n");
      return {
        role: m.sender === "human" ? ("user" as const) : ("assistant" as const),
        content,
      };
    });
  if (messages.length === 0 || !messages.some((m) => m.role === "assistant")) return null;
  return {
    platform: "claude",
    conversationId: uuid,
    title: typeof d.name === "string" && d.name ? d.name : "Claude 对话",
    url: `https://claude.ai/chat/${uuid}`,
    messages,
  };
}
