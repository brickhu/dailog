/** 脚本编辑模型（纯函数，可单测）：段落增删改移 + 发言者切换 */

export interface ScriptSegment {
  speaker: "host" | "guest";
  text: string;
}

export type ScriptEditorOp =
  | { type: "updateText"; index: number; text: string }
  | { type: "setSpeaker"; index: number; speaker: ScriptSegment["speaker"] }
  | { type: "remove"; index: number }
  | { type: "move"; index: number; dir: -1 | 1 }
  | { type: "insert"; index: number; segment: ScriptSegment };

/** 不可变更新：返回新数组，越界操作幂等返回原数组 */
export function applyScriptOp(segments: ScriptSegment[], op: ScriptEditorOp): ScriptSegment[] {
  const { index } = op;
  if (index < 0 || index >= segments.length) return segments;
  switch (op.type) {
    case "updateText":
      return segments.map((s, i) => (i === index ? { ...s, text: op.text } : s));
    case "setSpeaker":
      return segments.map((s, i) => (i === index ? { ...s, speaker: op.speaker } : s));
    case "remove":
      return segments.filter((_, i) => i !== index);
    case "move": {
      const target = index + op.dir;
      if (target < 0 || target >= segments.length) return segments;
      const next = [...segments];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    }
    case "insert":
      return [...segments.slice(0, index), op.segment, ...segments.slice(index)];
  }
}

/** 单条文本字数（段落内换行不计数） */
export function segmentCharCount(text: string): number {
  return text.replace(/\s/g, "").length;
}

/** 全稿总字数（生成时长估算用） */
export function totalCharCount(segments: ScriptSegment[]): number {
  return segments.reduce((acc, s) => acc + segmentCharCount(s.text), 0);
}
