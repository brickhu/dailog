// claude 分享：API 优先（chat_snapshots 直连，改版后无需 orgId）
// → 通道重试：默认直连 → ScraperAPI（配 SCRAPERAPI_KEY 时）→
//   Web Unlocker 代理 → Web Unlocker API → CF Worker 转发 → 代理池。
// DOM 兜底：分享页是客户端渲染（41KB 壳无消息）——无 DOM 可提，靠通道切换。

import { httpGet, httpGetViaWorker, httpGetViaBrightdataProxy, httpGetViaScraperApi, proxyForIndex, hasProxies } from "../fetch";
import { fetchViaBrightdata } from "../unlocker";
import type { CollectedDialogue } from "../types";

const API = (shareId: string) =>
  `https://claude.ai/api/chat_snapshots/${shareId}?rendering_mode=messages&render_all_tools=true`;

export async function collectClaudeShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/claude\.ai\/share\/([0-9a-f-]{36})/)?.[1];
  if (!shareId) return null;

  // 通道顺序：默认（直连/首个代理）→ ScraperAPI → BD 代理 → BD API →
  // CF Worker → 代理池其余。失败都换下一个通道，重试到所有通道耗尽
  const attempts: Array<{
    proxy?: string;
    viaWorker?: boolean;
    viaUnlocker?: boolean;
    viaBdProxy?: boolean;
    viaScraper?: boolean;
  }> = [{ proxy: undefined }];
  if (process.env.SCRAPERAPI_KEY) attempts.push({ viaScraper: true });
  if (process.env.BRIGHTDATA_PROXY) attempts.push({ viaBdProxy: true });
  if (process.env.BRIGHTDATA_TOKEN) attempts.push({ viaUnlocker: true });
  if (process.env.CF_WORKER_URL) attempts.push({ viaWorker: true });
  if (hasProxies) {
    for (let i = 1; i < 3; i++) attempts.push({ proxy: proxyForIndex(i) });
  }

  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      const res = a.viaWorker
        ? await httpGetViaWorker(API(shareId))
        : a.viaUnlocker
          ? await fetchViaBrightdata(API(shareId))
          : a.viaBdProxy
            ? await httpGetViaBrightdataProxy(API(shareId))
            : a.viaScraper
              ? await httpGetViaScraperApi(API(shareId))
              : await httpGet(API(shareId), { proxy: a.proxy });
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
