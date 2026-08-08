// kimi 分享：SSR HYDRATION_INIT_STATE 内嵌对话（React Query 脱水状态，
// HTML 即数据源——queryKey ["share", id] 的 state.data 为 ChatShare）。

import { httpGet } from "../fetch";
import type { CollectedDialogue } from "../types";

export async function collectKimiShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/kimi\.com\/share\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const res = await httpGet(url);
  return parseKimiShare(res.body, shareId, url);
}

/** kimi 分享解析：HYDRATION_INIT_STATE 是 JS 字面量（BigInt/undefined），
 *  清洗后 JSON.parse。messages[].role=2 user / 3 assistant（其他系统 role
 *  过滤）；blocks[].content case="text" 的 TextBlock 正文（case="think" 的
 *  思考块跳过）；标题在 chat.name。 */
export function parseKimiShare(html: string, id: string, url: string): CollectedDialogue | null {
  const m = html.match(/window\.HYDRATION_INIT_STATE=(\{[\s\S]*?\})<\/script>/);
  if (!m) return null;
  let state: any;
  try {
    state = JSON.parse(
      m[1]
        .replace(/\bundefined\b/g, "null")
        .replace(/BigInt\("(\d+)"\)/g, '"$1"'),
    );
  } catch {
    return null;
  }
  const q = (state?.queries ?? []).find((x: any) => JSON.stringify(x?.queryKey).includes(`"share"`));
  const d = q?.state?.data;
  const msgs: any[] = Array.isArray(d?.messages) ? d.messages : [];
  const messages = msgs
    .map((msg: any) => ({
      role: msg.role === 2 ? ("user" as const) : msg.role === 3 ? ("assistant" as const) : null,
      content: (msg.blocks ?? [])
        .filter((b: any) => b?.content?.case === "text")
        .map((b: any) => b?.content?.value?.content ?? "")
        .filter(Boolean)
        .join("\n\n"),
    }))
    .filter((x): x is { role: "user" | "assistant"; content: string } => !!x.role && !!x.content);
  if (!messages.some((x) => x.role === "assistant")) return null;
  return {
    platform: "kimi",
    conversationId: id,
    title: typeof d?.chat?.name === "string" && d.chat.name ? d.chat.name : "Kimi 分享对话",
    url,
    messages,
  };
}
