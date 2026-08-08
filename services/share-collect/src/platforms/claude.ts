// claude 分享：API 优先（chat_snapshots 直连，改版后无需 orgId）
// → 被 CF 拦时按代理池逐个重试（claude 最重要的平台，重试最完整）。
// DOM 兜底：分享页是客户端渲染（41KB 壳无消息）——无 DOM 可提，靠代理。

import { httpGet, proxyForIndex, hasProxies } from "../fetch";
import type { CollectedDialogue } from "../types";

const API = (shareId: string) =>
  `https://claude.ai/api/chat_snapshots/${shareId}?rendering_mode=messages&render_all_tools=true`;

export async function collectClaudeShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/claude\.ai\/share\/([0-9a-f-]{36})/)?.[1];
  if (!shareId) return null;

  // 尝试顺序：默认通道（无代理环境=直连，有代理=第一个代理）→ 代理池其余通道。
  // 失败（CF 拦截/超时/解析失败）都换下一个通道——本机需代理、服务器可能被 CF 拦，
  // 统一重试到所有通道耗尽
  const attempts: Array<{ proxy?: string }> = [{ proxy: undefined }];
  if (hasProxies) {
    for (let i = 1; i < 3; i++) attempts.push({ proxy: proxyForIndex(i) });
  }

  let lastErr: unknown = null;
  for (const { proxy } of attempts) {
    try {
      const res = await httpGet(API(shareId), { proxy });
      const d = parseClaudeSnapshot(res.body, shareId, url);
      if (d) return d;
      lastErr = new Error("claude 响应解析失败"); // 挑战页/结构变化 → 换通道
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr; // 全部通道失败 → 明确失败（调用方转 platform_unreachable）
}

/** claude 快照解析（chat_messages: sender human/assistant + 附件正文并入；
 *  标题在 snapshot_name） */
export function parseClaudeSnapshot(json: string, id: string, url: string): CollectedDialogue | null {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  const msgs: any[] = Array.isArray(d?.chat_messages) ? d.chat_messages : [];
  const messages = msgs
    .filter((m) => m.sender === "human" || m.sender === "assistant")
    .map((m) => {
      const attach = (m.attachments ?? [])
        .filter((a: any) => a.extracted_content)
        .map((a: any) => a.extracted_content)
        .join("\n\n");
      return {
        role: m.sender === "human" ? ("user" as const) : ("assistant" as const),
        content: [m.text ?? "", attach].filter(Boolean).join("\n\n"),
      };
    });
  if (messages.length === 0) return null;
  return {
    platform: "claude",
    conversationId: id,
    title: typeof d.snapshot_name === "string" && d.snapshot_name ? d.snapshot_name : "Claude 分享对话",
    url,
    messages,
  };
}
