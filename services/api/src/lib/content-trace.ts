// 内容溯源工具（2026-08-12）：
// 分享快照是"复制快照"——B 基于 A 的对话续写再分享时，B 的消息序列以 A 为前缀（相同文本 + 增量）。
// 平台 meta 无父子引用（调研确认），内容前缀关系是唯一可靠的跨对话溯源信号。
// 归一化规则：仅保留 role + content（trim 后），丢弃平台特有标记/空消息；
// 不压缩内部空白（保留原样更严格——前缀匹配要求逐条一致，误判率低）。

import { createHash } from "node:crypto";

export interface TraceMessage {
  role: string;
  content: unknown;
}

/** 归一化消息序列：[(role, contentTrimmed)...]，跳过无实质内容的条目 */
export function normalizeMessages(dialogue: TraceMessage[]): string[] {
  const seq: string[] = [];
  for (const m of dialogue) {
    if (typeof m.content !== "string") continue;
    const c = m.content.trim();
    if (!c) continue;
    seq.push(`${m.role}:${c}`);
  }
  return seq;
}

/** 内容指纹：归一化序列的 sha256 hex（精确重复检测用；node:crypto 同步计算） */
export function sequenceFingerprint(dialogue: TraceMessage[]): string {
  const seq = normalizeMessages(dialogue);
  return createHash("sha256").update(JSON.stringify(seq)).digest("hex");
}

/** 前缀判断：seq 以 prefix 的归一化序列为前缀，且 seq 更长（严格衍生：至少多 1 条消息） */
export function isDerivedSequence(seq: string[], prefix: string[]): boolean {
  if (prefix.length === 0) return false;
  if (seq.length <= prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (seq[i] !== prefix[i]) return false;
  }
  return true;
}

/** 前缀源候选：{ id, sourceTitle, 归一化序列 } */
export interface TraceCandidate {
  id: string;
  sourceTitle: string | null;
  messages: TraceMessage[];
}

/**
 * 前缀源检测：从候选集中找"内容以它为前缀"的快照，返回覆盖最深的那个（最长前缀）。
 * 要求：目标对话 ≥3 条归一化消息、源 ≥2 条（防短句误判）；无匹配 → null。
 */
export function detectPrefixSource(dialogue: TraceMessage[], candidates: TraceCandidate[]): { id: string; sourceTitle: string | null } | null {
  const seq = normalizeMessages(dialogue);
  if (seq.length < 3) return null;
  let best: { id: string; sourceTitle: string | null; len: number } | null = null;
  for (const c of candidates) {
    const cSeq = normalizeMessages(c.messages);
    if (cSeq.length < 2) continue;
    if (isDerivedSequence(seq, cSeq) && (!best || cSeq.length > best.len)) {
      best = { id: c.id, sourceTitle: c.sourceTitle, len: cSeq.length };
    }
  }
  return best ? { id: best.id, sourceTitle: best.sourceTitle } : null;
}
