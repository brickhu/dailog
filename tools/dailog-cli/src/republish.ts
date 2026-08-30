// 重新生成已发布节目（重做后更新）：multipart 上传新成品 → 服务端更新已有 episode 行
//   （保留 id/slug/期号/统计/精选/公开状态，覆盖 R2 音频/封面，publishedAt 刷新）
//   pnpm editor republish <episodeId> --title "..." [--audio final.m4a] [--cover c.jpg]
//     [--description ...] [--summary ...] [--references-file <json>] [--tags a,b] [--language zh] [--guest claude]
//   流程：episodes 定位 → detail <episodeId>（拿 submissionId/URL）→ 重跑 三步制作 → tts → merge → cover
//         → republish <episodeId>（本命令）——与 publish 相同参数，但目标是已发布节目而非新投稿
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, clearArtifacts, draftDir, writeProgress } from "./lib.js";

/** ffprobe 音频时长（秒）——meta durationSeconds 来源（页面显示「N 分钟」） */
function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" });
  return Math.round(parseFloat(out.trim()));
}

/** 读 PUB-STEP-2 元数据（metadata.json）——republish 元数据（description/summary/highlights/category/references/tags）来源；
 *  与 publish 一致：metadata.json 优先、旧草稿 fallback script.json */
function loadMetadata(submissionId: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(join(draftDir(submissionId), "metadata.json"), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface RepublishArgs {
  episodeId: string;
  audio?: string;
  cover?: string;
  title?: string;
  description?: string;
  summary?: string;
  referencesFile?: string;
  tags?: string[];
  language: string;
  guestId?: string;
}

function parseArgs(args: string[]): RepublishArgs {
  const episodeId = args[0];
  if (!episodeId) {
    console.error("用法：pnpm editor republish <episodeId> --title \"...\" [--audio final.m4a] [--cover c.jpg] [--description ...] [--summary ...] [--references-file <json>] [--tags a,b] [--language zh] [--guest claude]");
    process.exit(1);
  }
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  return {
    episodeId,
    audio: take("--audio"),
    cover: take("--cover"),
    title: take("--title"),
    description: take("--description"),
    summary: take("--summary"),
    referencesFile: take("--references-file"),
    tags: take("--tags")?.split(",").map((t) => t.trim()).filter(Boolean),
    language: take("--language") ?? "zh",
    guestId: take("--guest"),
  };
}

export async function republish(config: EditorConfig, args: string[]): Promise<void> {
  const p = parseArgs(args);
  if (!p.title) {
    console.error("[republish] --title 必填（节目标题）");
    process.exit(1);
  }

  // 目标节目详情（拿 submissionId——草稿目录按投稿隔离；同时确认节目存在/已发布）
  const ep = (await api(config, `/v1/editor/episodes/${p.episodeId}`).catch(() => null)) as
    { id?: string; submissionId?: string; status?: string; title?: string | null } | null;
  if (!ep || !ep.id) {
    console.error(`[republish] 节目 ${p.episodeId} 不存在——先 pnpm editor episodes 核对 id`);
    process.exit(1);
  }
  if (ep.status !== "published") {
    console.error(`[republish] 节目状态为 ${ep.status}（仅已发布节目可重新生成）`);
    process.exit(1);
  }
  const submissionId = ep.submissionId!;

  // 成品音频：--audio 或草稿目录 final.m4a（按投稿目录）
  const audio = p.audio ?? (() => {
    const fallback = `${draftDir(submissionId)}/final.m4a`;
    try { readFileSync(fallback); return fallback; } catch { return undefined; }
  })();
  if (!audio) {
    console.error(`[republish] 缺少成品音频（--audio 或草稿 ${draftDir(submissionId)}/final.m4a）——先跑 merge 或指定 --audio`);
    process.exit(1);
  }

  const form = new FormData();
  const audioBytes = readFileSync(audio);
  const isM4a = audio.toLowerCase().endsWith(".m4a");
  form.append("audio", new Blob([new Uint8Array(audioBytes)], { type: isM4a ? "audio/mp4" : "audio/mpeg" }), isM4a ? "final.m4a" : "final.mp3");
  if (p.cover) {
    const coverBytes = readFileSync(p.cover);
    form.append("cover", new Blob([new Uint8Array(coverBytes)], { type: "image/jpeg" }), "cover.jpg");
  }
  const meta: Record<string, unknown> = { title: p.title, language: p.language };
  const md = loadMetadata(submissionId);
  // description（PUB-STEP-2 metadata.json 自动读取；旧草稿 fallback script.json；--description 可覆盖）
  if (p.description) meta.description = p.description;
  else if (md && typeof md.description === "string" && md.description.trim()) meta.description = md.description.trim();
  else {
    try {
      const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as { description?: unknown } | null;
      if (script && !Array.isArray(script) && typeof script.description === "string" && script.description.trim()) {
        meta.description = script.description.trim();
      }
    } catch { /* 草稿无 script.json：description 可选，忽略 */ }
  }
  // summary（PUB-STEP-2 metadata.json 自动读取；旧草稿 fallback script.json；--summary 可覆盖）
  if (p.summary) meta.summary = p.summary;
  else if (md && typeof md.summary === "string" && md.summary.trim()) meta.summary = md.summary.trim();
  else {
    try {
      const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as { summary?: unknown } | null;
      if (script && !Array.isArray(script) && typeof script.summary === "string" && script.summary.trim()) {
        meta.summary = script.summary.trim();
      }
    } catch { /* 可选，忽略 */ }
  }
  // references（PUB-STEP-2 metadata.json 自动读取；--references-file 可覆盖）
  if (p.referencesFile) {
    try {
      const refs = JSON.parse(readFileSync(p.referencesFile, "utf8"));
      if (Array.isArray(refs)) meta.references = refs;
      else console.warn(`[republish] ⚠️ references-file 内容不是数组，忽略（${p.referencesFile}）`);
    } catch { console.warn(`[republish] ⚠️ references-file 读取/解析失败，忽略（${p.referencesFile}）`); }
  } else if (md && Array.isArray(md.references) && md.references.length > 0) {
    meta.references = md.references;
  }
  // tags（PUB-STEP-2 metadata.json 自动读取；--tags 可覆盖）
  if (p.tags?.length) meta.tags = p.tags;
  else if (md && Array.isArray(md.tags) && md.tags.length > 0) meta.tags = md.tags;
  if (p.guestId) meta.guestId = p.guestId;
  // 金句（PUB-STEP-2 metadata.json 自动读取；旧草稿 fallback script.json；可选——缺省/解析失败忽略）
  let highlights: unknown = null;
  if (md && Array.isArray(md.highlights)) highlights = md.highlights;
  if (!highlights) {
    try {
      const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as
        { highlights?: { text?: string }[] } | null;
      highlights = script && !Array.isArray(script) ? script.highlights : null;
    } catch { /* 草稿无 script.json：金句可选，忽略 */ }
  }
  if (Array.isArray(highlights)) {
    const hs = highlights
      .filter((h): h is { text: string } => !!h && typeof (h as { text?: unknown }).text === "string" && (h as { text: string }).text.trim().length > 0)
      .map((h) => ({ text: (h as { text: string }).text.trim().slice(0, 200) }))
      .slice(0, 5);
    if (hs.length) meta.highlights = hs;
  }
  // 分类（PUB-STEP-2 metadata.json 自动读取；旧草稿 fallback script.json：insight/experience/advice/inspiration）
  let category: unknown = null;
  if (md) category = md.category;
  if (!category) {
    try {
      const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as { category?: unknown } | null;
      category = script && !Array.isArray(script) ? script.category : null;
    } catch { /* 草稿无 script.json：分类可选，忽略 */ }
  }
  if (typeof category === "string" && ["insight", "experience", "advice", "inspiration"].includes(category)) {
    meta.category = category;
  }
  // durationSeconds：ffprobe 成品音频
  try {
    meta.durationSeconds = ffprobeDuration(audio);
  } catch { console.warn("[republish] ⚠️ ffprobe 时长读取失败，durationSeconds 缺省"); }
  form.append("meta", JSON.stringify(meta));

  console.log(`[republish] 更新已发布节目 ${p.episodeId}（投稿 ${submissionId}）：${audio}（${(audioBytes.length / 1024 / 1024).toFixed(1)}MB）…`);
  const res = await api(config, `/v1/editor/episodes/${p.episodeId}/republish`, { method: "POST", formData: form });
  console.log(`[republish] ✅ 已更新：dailog 第 ${(res as { number?: number }).number ?? "?"} 期「${p.title}」（链接/期号不变）`);
  writeProgress(submissionId, "republished"); // 重做是终态：不计入概览待办（见 RES）
  clearArtifacts(submissionId); // 同 publish 惯例：清理语音/封面大文件（文本草稿保留——对话/脚本可查阅/再重做，见 DRAFT）
}
