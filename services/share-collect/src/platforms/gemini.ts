// gemini 分享：batchexecute RPC（公开无 cookie；undici 传输，替代原型的
// curl 子进程——playwright request context 对该响应 Header overflow）。
// DOM 兜底：分享页是客户端渲染（HTML 无消息）——无 DOM 可提，靠重试/代理。

import { httpGet, httpPostForm, proxyForIndex, hasProxies } from "../fetch";
import type { CollectedDialogue } from "../types";

export async function collectGeminiShare(url: string): Promise<CollectedDialogue | null> {
  const shareId = url.match(/share\.gemini\.google\/([^/?#]+)/)?.[1];
  if (!shareId) return null;

  // 尝试顺序：默认通道（无代理环境=直连，有代理=第一个代理）→ 代理池其余通道
  const attempts: Array<{ proxy?: string }> = [{ proxy: undefined }];
  if (hasProxies) {
    for (let i = 1; i < 3; i++) attempts.push({ proxy: proxyForIndex(i) });
  }

  // 1) 拿 convId：share.gemini.google 301 → gemini.google.com/share/{convId}。
  //    undici 不自动跟随重定向——从 location 响应头提取
  let convId: string | null = null;
  for (const { proxy } of attempts) {
    try {
      const page = await httpGet(`https://share.gemini.google/${shareId}`, { proxy });
      const loc = page.headers["location"] ?? "";
      convId = loc.match(/gemini\.google\.com\/share\/([0-9A-Za-z]+)/)?.[1] ?? null;
      if (convId) break;
    } catch {
      // 换下一个通道
    }
  }
  if (!convId) return null;

  // 2) batchexecute RPC（最简参数 rpcids=ujx1Bf 即可）
  const postData = `f.req=${encodeURIComponent(JSON.stringify([[["ujx1Bf", `[null,"${convId}",[4]]`, null, "generic"]]]))}`;
  let lastErr: unknown = null;
  for (const { proxy } of attempts) {
    try {
      const res = await httpPostForm(`https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ujx1Bf`, postData, { proxy });
      const payload = parseGeminiBatch(res.body);
      if (!payload) return null;
      return parseGeminiPayload(payload, convId, url);
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

/** gemini batchexecute 响应解析：)]}' + \n\n 后的内容兼容两种格式——
 *  1) 直接整个 JSON（无长度行）；2) 长度分块（<长度>\n<JSON> 重复，容错去尾）。
 *  找到 ujx1Bf 块 → 返回 payload */
export function parseGeminiBatch(text: string): unknown[] | null {
  const head = text.indexOf("\n\n");
  if (head < 0) return null;
  const rest = text.slice(head + 2);
  // 格式 1：整个剩余就是 JSON
  try {
    const arr = JSON.parse(rest) as unknown[];
    if (Array.isArray(arr) && (arr[0] as any)?.[1] === "ujx1Bf") return JSON.parse((arr[0] as any)[2]) as unknown[];
  } catch {
    /* 落长度分块格式 */
  }
  // 格式 2：长度分块
  let pos = 0;
  while (pos < rest.length) {
    const nl = rest.indexOf("\n", pos);
    if (nl < 0) break;
    const len = Number(rest.slice(pos, nl));
    const start = nl + 1;
    const chunk = rest.slice(start, start + len);
    let arr: unknown[] | null = null;
    for (let cut = 0; cut <= 4; cut++) {
      try {
        arr = JSON.parse(chunk.slice(0, chunk.length - cut)) as unknown[];
        break;
      } catch {
        /* 长度前缀误差 → 去尾重试 */
      }
    }
    if (Array.isArray(arr) && (arr[0] as any)?.[1] === "ujx1Bf") return JSON.parse((arr[0] as any)[2]) as unknown[];
    pos = start + len;
  }
  return null;
}

/** gemini payload → dialogue（轮次结构 + 尾部标题） */
export function parseGeminiPayload(payload: unknown[], convId: string, url: string): CollectedDialogue | null {
  const inner = (payload as any)?.[0]?.[1] ?? (payload as any)?.[1] ?? payload;
  if (!Array.isArray(inner)) return null;
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  // 标题在 payload[0][2]：[true, "标题", null, ..., [1, convId, "模型"], true]
  let title = "Gemini 分享对话";
  const meta = (payload as any)?.[0]?.[2];
  if (Array.isArray(meta) && meta[0] === true && typeof meta[1] === "string" && meta[1].length > 0) title = meta[1];
  for (const el of inner) {
    if (!Array.isArray(el) || el.length < 4) continue;
    // user：el[2][0] 文本数组
    const userText = Array.isArray(el[2]?.[0]) ? el[2][0].filter((t: unknown) => typeof t === "string").join("\n\n").trim() : "";
    // assistant：el[3][0] 内 chunk[1] 文本数组
    let asstText = "";
    const chunks = el[3]?.[0];
    if (Array.isArray(chunks)) {
      for (const chunk of chunks) {
        if (Array.isArray(chunk) && Array.isArray(chunk[1])) {
          asstText += chunk[1].filter((t: unknown) => typeof t === "string").join("\n\n") + "\n\n";
        }
      }
      asstText = asstText.trim();
    }
    if (userText) messages.push({ role: "user", content: userText });
    if (asstText) messages.push({ role: "assistant", content: asstText });
  }
  if (!messages.some((m) => m.role === "assistant")) return null;
  return { platform: "gemini", conversationId: convId, title, url, messages };
}
