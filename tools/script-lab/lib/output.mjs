// 输出处理：容错 JSON 解析 / 自动识别摘要 / 轻量结构校验 / 落盘
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// 从 LLM 输出容错提取 JSON：去代码围栏 → 取首个 { 或 [ 的平衡区间 → 尾部逗号兜底
export function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/\x60\x60\x60(?:json)?\s*([\s\S]*?)\x60\x60\x60/);
  if (fence) t = fence[1].trim();
  const startIdx = (() => {
    const a = t.indexOf("{");
    const b = t.indexOf("[");
    if (a < 0) return b;
    if (b < 0) return a;
    return Math.min(a, b);
  })();
  if (startIdx < 0) return null;
  const open = t[startIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        const candidate = t.slice(startIdx, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          const fixed = candidate
            .replace(/,([\s\n\r]*[}\]])/g, "$1")
            .replace(/\/\/[^"\n]*/g, "")
            .replace(/\/\*[\s\S]*?\*\//g, "");
          try {
            return JSON.parse(fixed);
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

const COUNT_TAG = /\[[a-zA-Z][a-zA-Z \-]*\]/g;

function flatSegments(data) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.parts)) {
    const parts = data.parts.map((p) => (Array.isArray(p && p.segments) ? p.segments : []));
    return { parts, segments: parts.flat(), fields: Object.keys(data), data };
  }
  if (Array.isArray(data.segments)) return { parts: null, segments: data.segments, fields: Object.keys(data), data };
  if (Array.isArray(data)) return { parts: null, segments: data, fields: [], data };
  return null;
}

function summarizeScript(s) {
  const chars = s.segments.reduce((n, x) => n + (x && x.text ? x.text.length : 0), 0);
  const tags = s.segments.reduce((n, x) => n + ((x && x.text ? x.text.match(COUNT_TAG) : []) || []).length, 0);
  console.log("  [脚本] " + s.segments.length + " 段 · " + chars + " 字 · 情绪/停顿标签 " + tags + " 个");
  if (s.data.category) console.log("  category=" + s.data.category + " host=" + s.data.host + " guest=" + s.data.guest + " lang=" + s.data.lang);
  if (s.parts) {
    const names = ["点题", "对谈", "落点+收束"];
    s.parts.forEach((seg, i) => console.log("    parts[" + i + "] " + (names[i] || i) + "：" + seg.length + " 段"));
  }
  const warns = [];
  if (s.parts && s.parts.length !== 3) warns.push("parts 应为 3 段，实际 " + s.parts.length);
  if (s.parts && s.parts.some((p) => p.length === 0)) warns.push("存在空 parts（分段生成未合并）");
  for (const x of s.segments) {
    if (x && x.speaker !== "host" && x.speaker !== "guest") {
      warns.push("非法 speaker: " + x.speaker);
      break;
    }
  }
  if (s.parts) {
    const extra = s.fields.filter((f) => !["category", "parts", "host", "guest", "lang", "creationNote"].includes(f));
    if (extra.length > 0) warns.push("顶层混入非脚本字段：" + extra.join(", "));
  }
  if (warns.length > 0) {
    console.log("  ⚠️ 校验警告：");
    for (const w of warns) console.log("    - " + w);
  } else {
    console.log("  ✓ 轻量结构校验通过");
  }
  for (const x of s.segments.slice(0, 4)) {
    console.log("    [" + (x.speaker === "host" ? "主持人" : "嘉宾") + "] " + String(x.text || "").slice(0, 46) + (x.text && x.text.length > 46 ? "…" : ""));
  }
}

function summarizeSelection(data) {
  console.log("  [选题] verdict=" + data.verdict + " language=" + data.language);
  if (data.verdict === "reject" && data.reject) {
    console.log("  拒稿：[" + data.reject.code + "] " + data.reject.reason);
  }
  if (data.pass && Array.isArray(data.pass.ideas)) {
    data.pass.ideas.forEach((idea, i) => {
      const sc = idea.score || {};
      const total = typeof sc.total === "number" ? sc.total : "?";
      console.log("  思路 " + (i + 1) + " [" + idea.dimension + "] 得分 " + total + "：" + String(idea.title_draft || "").slice(0, 60));
    });
  }
}

function summarizeMeta(data) {
  console.log("  [元数据] title: " + String(data.title || "").slice(0, 60));
  console.log("  category=" + data.category + " tags=" + (Array.isArray(data.tags) ? data.tags.length : "?") + " highlights=" + (Array.isArray(data.highlights) ? data.highlights.length : "?"));
}

/** 自动识别输出类型并打印摘要：脚本 / 选题 / 元数据 / 通用 */
export function summarize(raw) {
  const data = parseJsonLoose(raw);
  if (!data) {
    console.log("  非 JSON 输出（前几行）：");
    console.log(String(raw).trim().split("\n").slice(0, 6).map((l) => "  " + l).join("\n").slice(0, 600));
    return;
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    console.log(Array.isArray(data) ? "  顶层数组，长度 " + data.length : "  非对象输出");
    return;
  }
  const s = flatSegments(data);
  if (s && s.segments.length > 0) return summarizeScript(s);
  if (data.verdict && (data.pass || data.reject)) return summarizeSelection(data);
  if (data.title && (data.description || data.tags || data.summary)) return summarizeMeta(data);
  console.log("  顶层对象键：" + Object.keys(data).join(", "));
}

export function writeRaw(outPath, raw) {
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, raw);
  return outPath;
}

export function writeJson(outPath, raw) {
  const data = parseJsonLoose(raw);
  if (data === null) return null;
  const jsonPath = outPath.replace(/\.(md|txt|out)$/i, ".json");
  if (jsonPath === outPath) return null;
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  return jsonPath;
}
