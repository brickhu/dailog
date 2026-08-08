// doubao 分享：SSR data-fn-args 内嵌 message_snapshot（HTML 即数据源，
// API 层与 DOM 层合一——直连页面 HTML 解析内嵌快照）。
// 海外数据中心 IP 直连被拒（海外访问受限）→ ScraperAPI 兜底（配了时）。

import { httpGet, httpGetViaScraperApi } from "../fetch";
import { fetchViaBrightdata } from "../unlocker";
import type { CollectedDialogue } from "../types";

export async function collectDoubaoShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/doubao\.com\/thread\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  // 直连（本机/国内环境可用；数据中心 IP 被拒则落后续通道）
  try {
    const res = await httpGet(url);
    const d = parseDoubaoShare(res.body, shareId, url);
    if (d) return d;
  } catch {
    /* 落兜底通道 */
  }
  // ScraperAPI（IP 池含住宅/亚洲，海外访问国内平台）→ Web Unlocker API
  if (process.env.SCRAPERAPI_KEY) {
    try {
      const res = await httpGetViaScraperApi(url);
      const d = parseDoubaoShare(res.body, shareId, url);
      if (d) return d;
    } catch {
      /* 落 unlocker */
    }
  }
  if (process.env.BRIGHTDATA_TOKEN) {
    const u = await fetchViaBrightdata(url);
    if (u.status === 200) {
      const d = parseDoubaoShare(u.body, shareId, url);
      if (d) return d;
    }
  }
  return null;
}

/** HTML 属性值实体解码（&quot; &amp; &#x27; 等） */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** doubao 分享解析：mergeLoaderData 的 data-fn-args 内嵌分享快照
 *  message_snapshot.message_list[i].content_block[j].content.text_block.text
 *  为 markdown 原文；user_type=1 用户 / 2 助手；标题在 share_info.share_name */
export function parseDoubaoShare(html: string, id: string, url: string): CollectedDialogue | null {
  const m = html.match(/data-fn-name="mergeLoaderData"[^>]*data-fn-args="((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  let args: unknown;
  try {
    args = JSON.parse(unescapeHtml(m[1]));
  } catch {
    return null;
  }
  // data-fn-args = [路由名, [loaderData...]]，message_snapshot 在深层字符串值里
  // （多层转义）——深度遍历找含 message_snapshot 的字符串，循环 JSON.parse 解层
  const stack: unknown[] = [args];
  let snap: any = null;
  while (stack.length && !snap) {
    const v = stack.pop();
    if (typeof v === "string") {
      if (v.includes("message_snapshot")) {
        let s: unknown = v;
        for (let i = 0; i < 5; i++) {
          try {
            const p = JSON.parse(s as string);
            if (p?.data?.message_snapshot?.message_list) { snap = p; break; }
            s = p; // 还嵌套着，继续解一层
          } catch {
            break;
          }
        }
      }
      continue;
    }
    if (v && typeof v === "object") {
      for (const k of Object.keys(v as object)) stack.push((v as Record<string, unknown>)[k]);
    }
  }
  const list: any[] = snap?.data?.message_snapshot?.message_list;
  if (!Array.isArray(list) || list.length === 0) return null;
  const messages = list
    .map((msg: any) => ({
      role: msg.user_type === 1 ? ("user" as const) : ("assistant" as const),
      content: (msg.content_block ?? [])
        .map((b: any) => b?.content?.text_block?.text ?? "")
        .filter(Boolean)
        .join("\n\n"),
    }))
    .filter((x) => x.content && (x.role === "user" || x.role === "assistant"));
  if (!messages.some((x) => x.role === "assistant")) return null;
  return {
    platform: "doubao",
    conversationId: id,
    title: snap?.data?.share_info?.share_name ?? "豆包分享对话",
    url,
    messages,
  };
}
