export type Platform =
  | "claude" | "deepseek" | "chatgpt" | "gemini"
  | "kimi" | "doubao" | "tongyi" | "plain";

export type Role = "user" | "assistant";

export interface DialogueMessage {
  role: Role;
  content: string;
}

export interface CollectedDialogue {
  platform: Platform;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
}

export const PLATFORMS: readonly Platform[] = [
  "claude", "deepseek", "chatgpt", "gemini", "kimi", "doubao", "tongyi", "plain",
];

export function isCollectedDialogue(value: unknown): value is CollectedDialogue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!PLATFORMS.includes(v.platform as Platform)) return false;
  if (typeof v.conversationId !== "string" || v.conversationId.length === 0) return false;
  if (typeof v.title !== "string") return false;
  if (typeof v.url !== "string" || !v.url.startsWith("http")) return false;
  if (!Array.isArray(v.messages) || v.messages.length === 0) return false;
  return v.messages.every((m) => {
    if (typeof m !== "object" || m === null) return false;
    const msg = m as Record<string, unknown>;
    return (msg.role === "user" || msg.role === "assistant") && typeof msg.content === "string";
  });
}

/** content → background 的消息协议 */
export const MSG_COLLECT = "dailogues:collect";
export const MSG_COLLECT_RESULT = "dailogues:collect-result";
