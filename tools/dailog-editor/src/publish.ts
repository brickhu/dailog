// 一次性上传发布（编辑本地制作成品 → dailog）：
//   multipart：audio（必填）+ cover（可选）+ meta JSON（title/description/tags/language/guestId/durationSeconds）
// 成功后 episode 直接 published + 投稿人收到通知（「dailog 第 N 期」）
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { EditorConfig } from "./lib.js";
import { api, clearArtifacts, draftDir, writeProgress } from "./lib.js";

/** ffprobe 音频时长（秒）——发布 meta 的 durationSeconds 来源（页面显示「N 分钟」） */
function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" });
  return Math.round(parseFloat(out.trim()));
}

interface PublishArgs {
  submissionId: string;
  audio?: string;
  cover?: string;
  title?: string;
  description?: string;
  tags?: string[];
  language: string;
  guestId?: string;
}

function parseArgs(args: string[]): PublishArgs {
  const submissionId = args[0];
  if (!submissionId) {
    console.error("用法：pnpm editor publish <submissionId> --title \"...\" [--audio final.mp3] [--cover c.jpg] [--description ...] [--tags a,b] [--language zh] [--guest claude]");
    process.exit(1);
  }
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  const audio = take("--audio") ?? (() => {
    const fallback = `${draftDir(submissionId)}/final.mp3`;
    try { readFileSync(fallback); return fallback; } catch { return undefined; }
  })();
  if (!audio) {
    console.error("[publish] 缺少成品音频（--audio 或草稿目录 final.mp3）——先运行 merge");
    process.exit(1);
  }
  return {
    submissionId,
    audio,
    cover: take("--cover"),
    title: take("--title"),
    description: take("--description"),
    tags: take("--tags")?.split(",").map((t) => t.trim()).filter(Boolean),
    language: take("--language") ?? "zh",
    guestId: take("--guest"),
  };
}

export async function publish(config: EditorConfig, args: string[]): Promise<void> {
  const p = parseArgs(args);
  if (!p.title) {
    console.error("[publish] --title 必填（节目标题）");
    process.exit(1);
  }

  const form = new FormData();
  const audioBytes = readFileSync(p.audio!);
  // 按文件后缀声明类型（merge 产出 final.m4a / 兼容旧 final.mp3）——服务端按扩展名存 R2 + 回 Content-Type
  const isM4a = p.audio!.toLowerCase().endsWith(".m4a");
  form.append("audio", new Blob([new Uint8Array(audioBytes)], { type: isM4a ? "audio/mp4" : "audio/mpeg" }), isM4a ? "final.m4a" : "final.mp3");
  if (p.cover) {
    const coverBytes = readFileSync(p.cover);
    form.append("cover", new Blob([new Uint8Array(coverBytes)], { type: "image/jpeg" }), "cover.jpg");
  }
  const meta: Record<string, unknown> = { title: p.title, language: p.language };
  if (p.description) meta.description = p.description;
  if (p.tags?.length) meta.tags = p.tags;
  if (p.guestId) meta.guestId = p.guestId;
  // durationSeconds：ffprobe 成品音频（merge 产物）——页面「N 分钟」展示
  try {
    meta.durationSeconds = ffprobeDuration(p.audio!);
  } catch {
    console.warn("[publish] ⚠️ ffprobe 时长读取失败，durationSeconds 缺省（页面将显示 0 分钟）");
  }
  form.append("meta", JSON.stringify(meta));

  console.log(`[publish] 上传 ${p.audio}（${(audioBytes.length / 1024 / 1024).toFixed(1)}MB）→ 发布投稿 ${p.submissionId}…`);
  const res = await api(config, `/v1/editor/submissions/${p.submissionId}/publish`, { method: "POST", formData: form });
  console.log(`[publish] ✅ 已发布：dailog 第 ${(res as { number?: number }).number ?? "?"} 期「${p.title}」`);
  const episodeId = (res as { episodeId?: string }).episodeId ?? "";
  writeProgress(p.submissionId, "published");
  const episodeUrl = config.siteUrl
    ? `${config.siteUrl.replace(/\/$/, "")}/episode/${episodeId}`
    : null;
  console.log(`[publish] 🎙 节目地址：${episodeUrl ?? "(未配置 siteUrl，请检查 .dailog-editor/envs.json)"}`);
  clearArtifacts(p.submissionId); // 发布是终态：清理语音/封面文件（文本草稿保留——对话/脚本可查阅/重做）
}
