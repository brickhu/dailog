// 手动粘贴解析（2026-08-12）：分享页被 CF 拦截时，用户复制对话内容粘贴导入。
// 平台复制格式不一——两级策略：
//  ① 说话人标记行（"You:"/"ChatGPT:"/"Human:"/"问："等，短行判定防误伤）→ 角色切换分消息
//  ② 无标记 → 空行分段，交替分配 user/assistant（首段 user）
// 目标：产出与 importer 同构的 { role, content }[]，后续管线（快照/溯源/审核）无差别复用。

export interface PasteMsg {
  role: "user" | "assistant";
  content: string;
}

/** 说话人标记：{ regex, role }。匹配行视为角色开始；标记行需足够短（防正文误判） */
const SPEAKER_MARKS: Array<{ re: RegExp; role: "user" | "assistant" }> = [
  // 用户侧
  { re: /^(你|我|用户|问题|问)[:：]?\s*$/i, role: "user" },
  { re: /^user\s*[:：]\s*$/i, role: "user" },
  { re: /^(you|human)\s*[:：]\s*$/i, role: "user" },
  { re: /^q[:：]?\s*$/i, role: "user" },
  // AI 侧
  { re: /^(ai|assistant|answer|chatgpt|claude|deepseek|kimi|gemini|perplexity|豆包|通义|答)[:：]?\s*$/i, role: "assistant" },
  { re: /^a[:：]?\s*$/i, role: "assistant" },
];

/** 行是否为说话人标记（短行 + 前缀匹配） */
function speakerOfLine(line: string): "user" | "assistant" | null {
  const t = line.trim();
  // 标记行必须短（≤24 字符），防正文句子误判为角色标记
  if (t.length > 24) return null;
  for (const { re, role } of SPEAKER_MARKS) {
    if (re.test(t)) return role;
  }
  return null;
}

/**
 * 解析粘贴文本 → 消息序列。
 * 规则：
 *  ① 说话人标记行切换角色（连续同角色合并；标记行本身不进入内容）
 *  ② 无任何标记 → 按空行分段交替（首段 user）
 *  ③ 过滤空消息；至少产出 1 条 user + 1 条 assistant 才返回非 null
 */
export function parsePasteText(text: string): PasteMsg[] | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const messages: PasteMsg[] = [];
  let current: PasteMsg | null = null;
  let sawMark = false;

  for (const raw of lines) {
    const mark = speakerOfLine(raw);
    if (mark) {
      sawMark = true;
      // 切换角色：结束当前消息（有内容才保留）
      if (current && current.content.trim()) messages.push(current);
      current = { role: mark, content: "" };
      continue;
    }
    const t = raw.trim();
    if (!t) continue;
    if (!current) current = { role: "user", content: "" };
    current.content += (current.content ? "\n" : "") + t;
  }
  if (current && current.content.trim()) messages.push(current);

  if (sawMark) {
    // 标记模式：直接产出（可能单角色连续——解析器尽力而为）
    const cleaned = messages.map((m) => ({ role: m.role, content: m.content.trim() })).filter((m) => m.content);
    return cleaned.length >= 2 ? cleaned : null;
  }

  // 无标记模式：按空行分段，交替 user/assistant（首段 user）
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.replace(/\n+/g, "\n").trim())
    .filter(Boolean);
  if (blocks.length < 2) return null;
  return blocks.map((b, i) => ({ role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant", content: b }));
}
