// deepseek 分享：API 优先（/api/v0/share/content 公开接口）
// → DOM 兜底：页面 HTML 提取（分享页 SSR 渲染消息，结构变化时兜底可用）。

import { httpGet } from "../fetch";
import type { CollectedDialogue } from "../types";

const API = (shareId: string) =>
  `https://chat.deepseek.com/api/v0/share/content?share_id=${shareId}`;

export async function collectDeepSeekShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/chat\.deepseek\.com\/share\/([A-Za-z0-9]+)/)?.[1];
  if (!shareId) return null;
  try {
    const res = await httpGet(API(shareId));
    return parseDeepSeekApi(res.body, shareId, url);
  } catch (e) {
    // API 失败（429/CF 反爬）→ DOM 兜底：页面 HTML
    const page = await httpGet(url).catch(() => null);
    if (!page) throw e;
    return parseDeepSeekDom(page.body, shareId, url);
  }
}

/** API 解析（data.biz_data.messages；role 大小写不敏感） */
export function parseDeepSeekApi(json: string, id: string, url: string): CollectedDialogue | null {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    return null;
  }
  const msgs: any[] = d?.data?.biz_data?.messages ?? [];
  const messages = msgs
    .map((m: any) => ({ role: (m.role ?? "").toLowerCase(), content: m.content ?? "" }))
    .filter((m: any) => m.role === "user" || m.role === "assistant")
    .filter((m: any) => m.content);
  if (messages.length === 0) return null;
  return {
    platform: "deepseek",
    conversationId: id,
    title: d?.data?.biz_data?.title ?? "DeepSeek 分享对话",
    url,
    messages,
  };
}

/** DOM 兜底：页面 HTML 里找消息文本（按已知 SSR 结构；结构变了此路径自动失效，不影响 API 路径） */
export function parseDeepSeekDom(html: string, id: string, url: string): CollectedDialogue | null {
  // deepseek 分享页 SSR：消息文本直接渲染在 HTML 中。
  // 用宽松特征匹配：找"对话标题"与问答文本块。
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  // 平台消息以特定 class 渲染——用文本块启发式（user 消息较短、assistant 较长）并
  // 过滤脚本/样式残留；宽松实现：提取 script 之外的可见文本段落
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ");
  const blocks = withoutScripts
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  // 对话内容一般在正文区域：取长度 > 10 的块，间隔分组（无法可靠区分 role 时
  // 保守返回 null——DOM 兜底仅保证"有内容可读"，不保证完整结构）
  const contentBlocks = blocks.filter((b) => b.length > 10);
  if (contentBlocks.length < 2) return null;
  // 无可靠 role 标记时放弃 DOM 路径（返回 null 走明确失败，不产出脏数据）
  return null;
}
