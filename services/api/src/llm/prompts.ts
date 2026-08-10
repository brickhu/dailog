import type { LlmMessage } from "./client";

/** 润色 prompt：输出 JSON { language, segments: [{speaker, text}] }；
 *  语言由 LLM 自动识别（跟随原对话语言，默认生成该语言音轨的脚本）；
 *  instruction 为用户方向指示（重新润色时可选）。
 *  情绪标注：为段落加 Fish Audio S2 情绪标签（[方括号]，随文本直达 TTS），
 *  情绪须贴合话题语境与场景推进（规则见 EMOTION_GUIDE）。 */
const EMOTION_GUIDE = `7. 情绪标注（Fish Audio S2 语法）：在文本中嵌入方括号情绪标签（如 [happy]），让每段话的情绪贴合话题与场景
   7.1 可用标签（只用下列标准名，可选强度修饰 slightly/very/extremely，如 [very excited]）：
   - 基础情绪：happy sad angry excited calm nervous confident surprised satisfied delighted scared worried upset frustrated depressed empathetic embarrassed moved proud relaxed grateful curious sarcastic
   - 进阶情绪：uncertain doubtful confused disappointed regretful hopeful nostalgic determined sympathetic anxious
   - 语气：in a hurry tone shouting screaming whispering soft tone emphasis
   - 音效：laughing chuckling sighing sobbing gasping groaning
   - 停顿（留白）：[break] 短停顿、[long-break] 长停顿
   - 组合示例：[sad][whispering]、[excited][laughing]、[slightly sad]
   7.2 规则：
   - 标签放句首；每句 1 个主情绪，复杂时最多组合 3 个；短句与中性叙述不加标签，避免过度标注
   - 情绪随场景推进自然变化（开场好奇/欢迎 → 探讨兴奋/自信 → 转折 surprised/uncertain → 共情 empathetic → 结尾 grateful/hopeful/determined），由对话内容推断，不得机械循环
   - 角色差异化：host=引导/共情/好奇/惊讶，guest=专业/自信/深沉/感慨
   - 标签是台词的一部分，会原样进入语音合成，请保证标签出现在话术最贴切的位置`;

export interface PolishCallMeta {
  /** host（用户）在节目中的自称；缺省用"主持人" */
  hostName?: string | null;
  /** AI 称呼（对话来源平台名：Claude/ChatGPT/豆包…）；缺省用"AI 嘉宾" */
  aiName?: string | null;
}

export function polishPrompt(
  messages: { role: string; content: string }[],
  instruction?: string | null,
  meta?: PolishCallMeta,
): LlmMessage[] {
  const direction = instruction
    ? `9. 用户方向指示（优先遵循，可指定情绪风格）：${instruction}\n`
    : "";
  const hostCall = meta?.hostName?.trim() || "主持人";
  const aiCall = meta?.aiName?.trim() || "AI 嘉宾";
  return [{
    role: "system",
    content: `你是播客制作人。把下面的用户与 AI 对话润色成二人对谈播客脚本（用户=主持人 host，AI=嘉宾 guest）。
重要：这是用于语音合成朗读的脚本（会由 TTS 生成播客音频），不是供阅读的文字底稿——一切以"听感"为准，写出来要让声音自然、适合朗读。
要求：
1. 先识别对话主要语言（zh/en/ja/ko 等），脚本语言与对话保持一致
2. 目标时长 5-10 分钟（约 1200-3000 字），压缩长段落、去除冗余
3. 理顺口语化表达，保留原意与关键信息；面向朗读：多用短句、自然断句，避免书面语和长修饰（如"此外""综上所述"），标点用于控制朗读节奏
4. 真人对话感（像真人聊天，不念稿）：
   - 留白：阐述长观点/复杂概念时要有停顿——用 [break]（短停）/ [long-break]（长停）或"嗯…"自然过渡，别一口气说完
   - 穿插：自然融入"对""当然""嗯""确实"等反馈接话，像真实对谈一样有来有回（可嵌入自己话里，也可作对方长段后的简短回应）
   - 比喻：复杂概念用听众熟悉的生活化比喻解释，把抽象变具体
5. 开场结构（像真实访谈节目）：主持人先向听众打招呼，再介绍自己（自称「${hostCall}」，如"大家好，欢迎收听…，我是${hostCall}"），接着介绍今天的嘉宾（自称「${aiCall}」，身份与话题），最后嘉宾打招呼回应；开场约 2-4 段，用 [happy]/[excited] 等积极情绪开场，切忌直接进入正题
6. 多主题切分：长对话可能包含多个独立主题——识别并切分为多个脚本（每个主题一个脚本，各自独立成期）
7. 每个脚本附带：title（简洁有吸引力的脚本标题）、creationNote（创作说明——给创作者看：这段脚本讲什么、为什么值得做成一期）
8. 输出 JSON：{"language": "zh"|"en"|..., "scripts": [{"topic": "简短主题名", "title": "脚本标题", "creationNote": "创作说明", "segments": [{"speaker": "host"|"guest", "text": "..."}]}]}，不要输出其他内容
8. 若对话内容不足以拆分为有意义的主题（纯寒暄/无实质内容/主题无法独立成期），输出 {"quality_failed": true, "reason": "简短原因"}，不要输出脚本
${EMOTION_GUIDE}
${direction}`,
  }, {
    role: "user",
    content: messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
  }];
}

/** 安全门 + 节目元数据 prompt（s4）：安全检测 + 生成节目 title/desc/tags/topic。
 *  输出 { pass, reason?, title, description, tags[], topic }——pass=false 时不生成元数据 */
export function safetyMetaPrompt(segments: { speaker: string; text: string }[]): LlmMessage[] {
  return [{
    role: "system",
    content: `你是 dailog 播客平台的内容安全审核员与节目编辑。审核一段播客脚本（用户=host，AI=guest）：
1. 违规内容（色情、违法、仇恨言论、诈骗、暴力煽动等）→ 拒绝
2. 通过时生成节目元数据：title（简洁有吸引力的节目标题）、description（2-3 句节目简介）、tags（3-5 个话题标签）、topic（一句话主题）
只输出 JSON：{"pass": true|false, "reason": "违规说明（仅 pass=false 时）", "title": "…", "description": "…", "tags": ["…"], "topic": "…"}`,
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
