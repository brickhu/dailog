// 与 services/api/src/dialogue.ts 保持一致（分享采集输出 = 导入输入）
export type Platform = "claude" | "deepseek" | "chatgpt" | "gemini" | "kimi" | "doubao" | "perplexity";

export interface DialogueMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CollectedDialogue {
  platform: Platform;
  conversationId: string;
  title: string;
  url: string;
  messages: DialogueMessage[];
}

/** 采集失败（可诊断：状态码 + CF 特征）——不静默吞错 */
export interface CollectError {
  error:
    | "platform_unreachable"
    | "parse_failed"
    | "invalid_url"
    | "unsupported_platform"
    | "share_unavailable";
  platform?: Platform;
  detail?: {
    status?: number;
    cf?: boolean;
    stage?: string;
    message?: string;
  };
}

const PLATFORMS: readonly Platform[] = ["claude", "deepseek", "chatgpt", "gemini", "kimi", "doubao", "perplexity"];

/** 结果判别（与 services/api/src/dialogue.ts 同构）：dialogue 与 CollectError 的区分 */
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
