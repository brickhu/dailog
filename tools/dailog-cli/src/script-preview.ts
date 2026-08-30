// 脚本预览（人工确认门）：生成脚本后展示摘要与分段，供编辑确认后再进 tts
//   pnpm editor script-preview <submissionId> [--script script.json]
//   → 展示：主题/标题/字数/时长估算/段数/每段角色与开头 → 编辑确认或要求修改
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { draftDir } from "./lib.js";

// 中文朗读语速估算（字/分钟）——1200-3000 字 ≈ 5-10 分钟
const ZH_CHARS_PER_MIN = 280;

function pickScript(submissionId: string, explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  const dir = draftDir(submissionId);
  // 草稿目录里找 script*.json（约定命名）
  if (existsSync(dir)) {
    const candidates = readdirSync(dir).filter((f) => /^script.*\.json$/.test(f));
    if (candidates.length > 0) return join(dir, candidates[0]);
  }
  console.error(`[script-preview] 未找到脚本（草稿 ${dir}/script*.json 或 --script 指定）——先按 skill ④ 生成脚本`);
  process.exit(1);
}

export async function scriptPreview(config: EditorConfig, args: string[]): Promise<void> {
  const submissionId = args[0];
  const scriptIdx = args.indexOf("--script");
  const explicit = scriptIdx >= 0 && args[scriptIdx + 1] ? args[scriptIdx + 1] : undefined;
  if (!submissionId) {
    console.error("用法：pnpm editor script-preview <submissionId> [--script script.json]");
    process.exit(1);
  }
  const path = pickScript(submissionId, explicit);
  const raw = JSON.parse(readFileSync(path, "utf-8")) as {
    category?: string;
    host?: string;
    guest?: string;
    lang?: string;
    topic?: string;
    title?: string;
    creationNote?: string;
    parts?: Array<{ segments?: Array<{ speaker: string; text: string }> }>;
    segments?: Array<{ speaker: string; text: string }>;
  } | Array<{ speaker: string; text: string }>;
  let segments: Array<{ speaker: string; text: string }>;
  if (Array.isArray(raw)) segments = raw;
  else if (Array.isArray(raw.parts) && raw.parts.length > 0) segments = raw.parts.flatMap((p) => p.segments ?? []);
  else segments = raw.segments ?? [];
  if (segments.length === 0) {
    console.error("[script-preview] 脚本为空（需要 parts: [{segments}] 或 segments: [{speaker, text}]）");
    process.exit(1);
  }

  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  const minutes = Math.round((chars / ZH_CHARS_PER_MIN) * 10) / 10;
  const users = segments.filter((s) => s.speaker === "host").length;
  const category = !Array.isArray(raw) ? raw.category ?? null : null;
  const host = !Array.isArray(raw) ? raw.host ?? null : null;
  const guest = !Array.isArray(raw) ? raw.guest ?? null : null;
  const topics = !Array.isArray(raw) ? raw.topic ?? null : null;
  const title = !Array.isArray(raw) ? raw.title ?? null : null;

  console.log(`[script-preview] 脚本：${path}`);
  if (category) console.log(`  分类：${category}`);
  if (host || guest) console.log(`  对谈：${host ?? "?"} × ${guest ?? "?"}`);
  if (title) console.log(`  标题：${title}`);
  if (topics) console.log(`  主题：${topics}`);
  if (!Array.isArray(raw) && raw.creationNote) console.log(`  创作说明：${raw.creationNote}`);
  console.log(`  统计：${segments.length} 段（host ${users} / guest ${segments.length - users}）· ${chars} 字 · 约 ${minutes} 分钟`);
  console.log("  分段预览：");
  segments.forEach((s, i) => {
    const first = s.text.replace(/\s+/g, " ").slice(0, 50);
    console.log(`    [${String(i + 1).padStart(2, " ")}] ${s.speaker === "host" ? "主持人" : "嘉宾"}：${first}${s.text.length > 50 ? "…" : ""}`);
  });
  console.log("\n[script-preview] 确认门：请编辑确认脚本（内容/时长/称呼/情绪）——");
  console.log("  · 确认 → 进入 tts：pnpm editor tts <id> --script <script.json> --language <lang> [--guest <platform>]");
  console.log("  · 修改 → 按方向指示重新生成（更简短/换开场/改情绪/调整称呼），生成后再 preview 确认");
}
