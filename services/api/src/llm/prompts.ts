import type { LlmMessage } from "./client";

export interface QualityResult { pass: boolean; reason?: string; language?: "zh" | "en"; }

/** 质量门 prompt：输出 JSON { pass, reason?, language } */
export function qualityCheckPrompt(messages: { role: string; content: string }[]): LlmMessage[] {
  return [{
    role: "system",
    content: `你是 dailogues 播客平台的内容质量审核员。审核一段用户与 AI 的对话是否适合制作成播客单集。
拒绝标准（任一命中即拒绝）：
1. 对话过短（少于 3 轮）
2. 纯寒暄、无主题
3. 信息量不足（无实质内容）
4. 涉及违规内容（色情/违法/仇恨/诈骗等）
另需识别对话语言（zh 或 en）。
只输出 JSON：{"pass": true|false, "reason": "拒绝原因（仅 pass=false 时）", "language": "zh"|"en"}`,
  }, {
    role: "user",
    content: `对话内容：\n${messages.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
  }];
}

/** 润色 prompt：输出 JSON 数组 [{speaker, text}] */
export function polishPrompt(messages: { role: string; content: string }[], language: string): LlmMessage[] {
  return [{
    role: "system",
    content: `你是播客制作人。把下面的用户与 AI 对话润色成二人对谈播客脚本（用户=主持人 host，AI=嘉宾 guest）。
要求：
1. 语言与对话保持一致（当前语言：${language}）
2. 目标时长 5-10 分钟（约 1200-3000 字），压缩长段落、去除冗余
3. 理顺口语化表达，保留原意与关键信息
4. 输出 JSON 数组：[{"speaker": "host"|"guest", "text": "..."}]，不要输出其他内容`,
  }, {
    role: "user",
    content: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
  }];
}

/** 容错 JSON 解析：去 ```json 围栏，截取首个 [ 或 { 到匹配的结尾 */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fallthrough */ }
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error("json_parse_failed");
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") { depth -= 1; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)); }
  }
  throw new Error("json_parse_failed");
}
