// 与 apps/extension/src/shared.ts 保持一致；若未来双写漂移则抽 @dailogues/shared
export type Platform = "claude" | "deepseek" | "chatgpt" | "gemini" | "kimi" | "doubao" | "tongyi" | "plain";

export interface DialogueMessage { role: "user" | "assistant"; content: string; }

export interface CollectedDialogue {
  platform: Platform;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
}

const PLATFORMS: readonly Platform[] = ["claude", "deepseek", "chatgpt", "gemini", "kimi", "doubao", "tongyi", "plain"];

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
