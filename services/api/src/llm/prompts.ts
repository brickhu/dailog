import type { LlmMessage } from "./client";

/** 润色 prompt：输出 JSON { language, segments: [{speaker, text}] }；
 *  语言由 LLM 自动识别（跟随原对话语言，默认生成该语言音轨的脚本）；
 *  instruction 为用户方向指示（重新润色时可选）。
 *  情绪标注：为段落加 Fish Audio S2 情绪标签（[方括号]，随文本直达 TTS），
 *  情绪须贴合话题语境与场景推进（规则见 EMOTION_GUIDE）。 */
const EMOTION_GUIDE = `5. 情绪标注（Fish Audio S2 语法）：在文本中嵌入方括号情绪标签（如 [happy]），让每段话的情绪贴合话题与场景
   5.1 可用标签（只用下列标准名，可选强度修饰 slightly/very/extremely，如 [very excited]）：
   - 基础情绪：happy sad angry excited calm nervous confident surprised satisfied delighted scared worried upset frustrated depressed empathetic embarrassed moved proud relaxed grateful curious sarcastic
   - 进阶情绪：uncertain doubtful confused disappointed regretful hopeful nostalgic determined sympathetic anxious
   - 语气：in a hurry tone shouting screaming whispering soft tone emphasis
   - 音效：laughing chuckling sighing sobbing gasping groaning
   - 组合示例：[sad][whispering]、[excited][laughing]、[slightly sad]
   5.2 规则：
   - 标签放句首；每句 1 个主情绪，复杂时最多组合 3 个；短句与中性叙述不加标签，避免过度标注
   - 情绪随场景推进自然变化（开场好奇/欢迎 → 探讨兴奋/自信 → 转折 surprised/uncertain → 共情 empathetic → 结尾 grateful/hopeful/determined），由对话内容推断，不得机械循环
   - 角色差异化：host=引导/共情/好奇/惊讶，guest=专业/自信/深沉/感慨
   - 标签是台词的一部分，会原样进入语音合成，请保证标签出现在话术最贴切的位置`;

export function polishPrompt(messages: { role: string; content: string }[], instruction?: string | null): LlmMessage[] {
  const direction = instruction
    ? `6. 用户方向指示（优先遵循，可指定情绪风格）：${instruction}\n`
    : "";
  return [{
    role: "system",
    content: `你是播客制作人。把下面的用户与 AI 对话润色成二人对谈播客脚本（用户=主持人 host，AI=嘉宾 guest）。
要求：
1. 先识别对话主要语言（zh/en/ja/ko 等），脚本语言与对话保持一致
2. 目标时长 5-10 分钟（约 1200-3000 字），压缩长段落、去除冗余
3. 理顺口语化表达，保留原意与关键信息
4. 输出 JSON：{"language": "zh"|"en"|..., "segments": [{"speaker": "host"|"guest", "text": "..."}]}，不要输出其他内容
${EMOTION_GUIDE}
${direction}`,
  }, {
    role: "user",
    content: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
  }];
}

/** 安全门 prompt：输出 JSON { pass, reason? }——色情/违法/仇恨/诈骗等违规内容 */
export function safetyCheckPrompt(segments: { speaker: string; text: string }[]): LlmMessage[] {
  return [{
    role: "system",
    content: `你是 dailog 播客平台的内容安全审核员。审核一段播客脚本（用户=host，AI=guest）是否包含违规内容：色情、违法、仇恨言论、诈骗、暴力煽动等。
只输出 JSON：{"pass": true|false, "reason": "违规说明（仅 pass=false 时）"}`,
  }, {
    role: "user",
    content: segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
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
