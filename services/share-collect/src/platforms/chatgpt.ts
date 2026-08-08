// chatgpt 分享：API 优先（RSC payload 解码——全量 34 单元免滚动）
// → DOM 兜底：静态 HTML 的 data-message-author-role 标记（仅渲染部分，最后手段）。

import { httpGet } from "../fetch";
import type { CollectedDialogue } from "../types";

export async function collectChatgptShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/chatgpt\.com\/share\/([^/?#]+)/)?.[1];
  if (!shareId) return null;
  const res = await httpGet(url);
  const rsc = parseChatgptShareRsc(res.body, shareId, url);
  if (rsc) return rsc;
  return parseChatgptShareHtml(res.body, shareId, url);
}

// ---------- RSC payload 解码（React Router flight 格式，全量对话） ----------
// 分享页 HTML 内嵌 streamController.enqueue("...") 多段 payload：每段为一个
// JSON 数组（值表：对象 {"_N": M} 引用表中键名/值；N 负数/越界 = undefined；
// 原始数值时间戳直接落表）。根元素即 loaderData 所在对象。多个 enqueue chunk
// 各自独立成表，首个 chunk（P1: 前缀）含全部数据，其余是空对象占位。

/** 提取并解析全部 enqueue chunk → 表格数组列表（已剥离 P\d+: 前缀） */
export function extractRscChunks(html: string): unknown[][] {
  const chunks: unknown[][] = [];
  const re = /streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const doc = JSON.parse(`"${m[1]}"`) as string;
      chunks.push(JSON.parse(doc.replace(/^P\d+:/, "")) as unknown[]);
    } catch {
      /* 非 JSON 片段跳过 */
    }
  }
  return chunks;
}

/** 值表解码：共享引用记忆化（每个索引只展开一次，避免共享子树指数爆炸） */
export function decodeRscTable(arr: unknown[]): unknown {
  const cache = new Map<number, unknown>();
  const resolve = (v: unknown, depth = 0): unknown => {
    if (depth > 40) return undefined;
    if (typeof v === "number") {
      if (v < 0 || v >= arr.length) return v; // 越界/负数 → 原样（时间戳等）
      if (cache.has(v)) return cache.get(v);
      const val = resolve(arr[v], depth + 1);
      cache.set(v, val);
      return val;
    }
    if (Array.isArray(v)) return v.map((x) => resolve(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v)) {
        if (k.startsWith("_")) {
          const name = resolve(arr[Number(k.slice(1))], depth + 1);
          out[name as string] = resolve((v as Record<string, unknown>)[k], depth + 1);
        } else out[k] = resolve((v as Record<string, unknown>)[k], depth + 1);
      }
      return out;
    }
    return v;
  };
  return resolve(0);
}

/** chatgpt 分享 RSC 解析：解码 loaderData → serverResponse.data（与登录态
 *  backend-api/conversation 同构的 mapping 节点图）→ 全量消息（免滚动免登录） */
export function parseChatgptShareRsc(html: string, id: string, url: string): CollectedDialogue | null {
  const chunks = extractRscChunks(html);
  if (chunks.length === 0) return null;
  let d: any = null;
  for (const chunk of chunks) {
    const root = decodeRscTable(chunk) as any;
    const data = root?.loaderData?.["routes/share.$shareId.($action)"]?.serverResponse?.data;
    if (data?.mapping) {
      d = data;
      break;
    }
  }
  if (!d) return null;
  // children DFS：根节点 → 子节点 → 拼接 parts → 过滤空
  const mapping: Record<string, any> = d.mapping;
  const rootId = Object.keys(mapping).find((k) => !mapping[k]?.message);
  if (!rootId) return null;
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = mapping[nodeId];
    if (!node) return;
    const role = node.message?.author?.role;
    if (role === "user" || role === "assistant") {
      const parts = (node.message?.content?.parts ?? []).filter((p: unknown) => typeof p === "string");
      const content = (parts as string[]).join("\n\n");
      if (content) messages.push({ role, content });
    }
    for (const c of node.children ?? []) visit(c);
  };
  visit(rootId);
  if (messages.length === 0) return null;
  return {
    platform: "chatgpt",
    conversationId: typeof d.conversation_id === "string" && d.conversation_id ? d.conversation_id : id,
    title: typeof d.title === "string" && d.title ? d.title : "ChatGPT 分享对话",
    url,
    messages,
  };
}

/** chatgpt 分享 DOM 兜底：静态 HTML 里 data-message-author-role 标记的消息
 *  （仅 SSR 渲染部分——RSC 解码失败时的最后手段） */
export function parseChatgptShareHtml(html: string, id: string, url: string): CollectedDialogue | null {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  // lookahead 从完整消息 div 边界切分（避免停在开标签内部残留 <div）
  const re = /data-message-author-role="(user|assistant)"[^>]*>([\s\S]*?)(?=<div\b[^>]*data-message-author-role=|\s*<\/section>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const role = m[1] as "user" | "assistant";
    const frag = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (frag) messages.push({ role, content: frag });
  }
  if (messages.length === 0) return null;
  return { platform: "chatgpt", conversationId: id, title: "ChatGPT 分享对话", url, messages };
}
