/** 容错 JSON 提取（复制自 services/api/src/llm/prompts.ts：LLM 输出可能带 ```json 围栏或前后杂文本） */
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

/** 尝试把文本解析成脚本段落数组（流式过程中增量使用）；解析失败返回 null */
export function tryParseSegments(text: string): Array<{ speaker: string; text: string }> | null {
  try {
    const parsed = parseJsonLoose(text);
    if (!Array.isArray(parsed)) return null;
    return parsed as Array<{ speaker: string; text: string }>;
  } catch {
    return null;
  }
}
