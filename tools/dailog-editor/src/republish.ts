// 重新生成已发布节目（重做后更新）：multipart 上传新成品 → 服务端更新已有 episode 行
//   （保留 id/slug/期号/统计/精选/公开状态，覆盖 R2 音频/封面，publishedAt 刷新）
//   pnpm editor republish <episodeId> --title "..." [--audio final.mp3] [--cover c.jpg]
//     [--description ...] [--summary ...] [--references-file <json>] [--tags a,b] [--language zh] [--guest claude]
//   流程：episodes 定位 → detail <episodeId>（拿 submissionId/URL）→ 重跑 三步制作 → tts → merge → cover
//         → republish <episodeId>（本命令）——与 publish 相同参数，但目标是已发布节目而非新投稿
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, draftDir } from "./lib.js";

/** ffprobe 音频时长（秒）——meta durationSeconds 来源（页面显示「N 分钟」） */
function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" });
  return Math.round(parseFloat(out.trim()));
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
    console.error("用法：pnpm editor republish <episodeId> --title \"...\" [--audio final.mp3] [--cover c.jpg] [--description ...] [--summary ...] [--references-file <json>] [--tags a,b] [--language zh] [--guest claude]");
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

  // 成品音频：--audio 或草稿目录 final.mp3（按投稿目录）
  const audio = p.audio ?? (() => {
    const fallback = `${draftDir(submissionId)}/final.mp3`;
    try { readFileSync(fallback); return fallback; } catch { return undefined; }
  })();
  if (!audio) {
    console.error(`[republish] 缺少成品音频（--audio 或草稿 ${draftDir(submissionId)}/final.mp3）——先跑 merge 或指定 --audio`);
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
  if (p.description) meta.description = p.description;
  if (!p.description) {
    try {
      const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as { description?: unknown } | null;
      if (script && !Array.isArray(script) && typeof script.description === "string" && script.description.trim()) {
        meta.description = script.description.trim();
      }
    } catch { /* 草稿无 script.json：description 可选，忽略 */ }
  }
  if (p.summary) meta.summary = p.summary;
  if (p.referencesFile) {
    try {
      const refs = JSON.parse(readFileSync(p.referencesFile, "utf8"));
      if (Array.isArray(refs)) meta.references = refs;
      else console.warn(`[republish] ⚠️ references-file 内容不是数组，忽略（${p.referencesFile}）`);
    } catch { console.warn(`[republish] ⚠️ references-file 读取/解析失败，忽略（${p.referencesFile}）`); }
  }
  if (p.tags?.length) meta.tags = p.tags;
  if (p.guestId) meta.guestId = p.guestId;
  // 金句（script.json highlights，自动）
  try {
    const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as { highlights?: { text?: string }[] } | null;
    const highlights = script && !Array.isArray(script) ? script.highlights : null;
    if (Array.isArray(highlights)) {
      const hs = highlights
        .filter((h): h is { text: string } => !!h && typeof h.text === "string" && h.text.trim().length > 0)
        .map((h) => ({ text: h.text.trim().slice(0, 200) }))
        .slice(0, 5);
      if (hs.length) meta.highlights = hs;
    }
  } catch { /* 可选，忽略 */ }
  // 分类（script.json category，自动）
  try {
    const script = JSON.parse(readFileSync(join(draftDir(submissionId), "script.json"), "utf8")) as { category?: unknown } | null;
    const category = script && !Array.isArray(script) && typeof script.category === "string" &&
      ["insight", "experience", "advice", "inspiration"].includes(script.category)
      ? script.category
      : null;
    if (category) meta.category = category;
  } catch { /* 可选，忽略 */ }
  // durationSeconds：ffprobe 成品音频
  try {
    meta.durationSeconds = ffprobeDuration(audio);
  } catch { console.warn("[republish] ⚠️ ffprobe 时长读取失败，durationSeconds 缺省"); }
  form.append("meta", JSON.stringify(meta));

  console.log(`[republish] 更新已发布节目 ${p.episodeId}（投稿 ${submissionId}）：${audio}（${(audioBytes.length / 1024 / 1024).toFixed(1)}MB）…`);
  const res = await api(config, `/v1/editor/episodes/${p.episodeId}/republish`, { method: "POST", formData: form });
  console.log(`[republish] ✅ 已更新：dailog 第 ${(res as { number?: number }).number ?? "?"} 期「${p.title}」（链接/期号不变）`);
}
