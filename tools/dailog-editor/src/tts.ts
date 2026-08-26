// 整集语音合成（multi speaker——官方多说话人接口）：
//   pnpm editor tts <submissionId> --script <script.json> [--language zh] [--guest <platform>]
//   · 默认：整集一次合成 → drafts/{submissionId}/full.mp3
//   · --parts：按 script.json 段落的 part 字段分 3 段独立合成（1=开场+定向 2=对谈 3=落点+收束）
//     → 每段一次请求（part1/2/3.mp3）→ 拼接 full.mp3（段间 0.6s 静音）——长稿输入更短，单段可独立重做
//   · --part <n>：只重跑第 n 段（part{n}.mp3）→ 与已有段落重新拼接 full.mp3（省配额）
//   → POST /v1/editor/tts（JSON：submissionId + language + guestId + segments）
//   → 服务端：host 采样（R2）+ guest 声线（guest_voice_samples）→ multi speaker 合成
//   → 合成：pnpm editor merge（intro + full + outro）
import { writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { EditorConfig } from "./lib.js";
import { api, draftDir, readScript, writeProgress, type ScriptSegment } from "./lib.js";

/** 平台枚举（guests 表；--guest 取值） */
const PLATFORMS = ["claude", "chatgpt", "deepseek", "gemini", "kimi", "doubao", "tongyi", "perplexity"];
/** part 1-3 分段标签（与 script-craft 五拍映射：①+②=1，③=2，④+⑤=3） */
const PART_LABELS = ["", "开场+定向", "对谈", "落点+收束"];

interface ParsedArgs {
  submissionId: string;
  scriptPath: string;
  language: string;
  platform: string | null;
  parts: boolean;
  part: number | null;
}

function parseArgs(args: string[]): ParsedArgs {
  const submissionId = args[0];
  const scriptIdx = args.indexOf("--script");
  const langIdx = args.indexOf("--language");
  const guestIdx = args.indexOf("--guest");
  const partIdx = args.indexOf("--part");
  const parts = args.includes("--parts");
  if (!submissionId || scriptIdx < 0 || !args[scriptIdx + 1]) {
    console.error("用法：pnpm editor tts <submissionId> --script <script.json> [--language zh|en] [--guest <platform>] [--parts | --part <1|2|3>]");
    process.exit(1);
  }
  const language = langIdx >= 0 && args[langIdx + 1] ? args[langIdx + 1] : "zh";
  if (!/^[a-z]{2,3}$/i.test(language)) {
    console.error(`[tts] 非法语言：${language}（如 zh/en）`);
    process.exit(1);
  }
  const platform = guestIdx >= 0 && args[guestIdx + 1] ? args[guestIdx + 1].toLowerCase() : null;
  if (platform && !PLATFORMS.includes(platform)) {
    console.error(`[tts] 未知平台：${platform}（可用：${PLATFORMS.join(" / ")}）`);
    process.exit(1);
  }
  let part: number | null = null;
  if (partIdx >= 0) {
    part = Number(args[partIdx + 1]);
    if (!Number.isInteger(part) || part < 1 || part > 3) {
      console.error("[tts] --part 取值 1|2|3（1=开场+定向 2=对谈 3=落点+收束）");
      process.exit(1);
    }
  }
  if (parts && part !== null) {
    console.error("[tts] --parts 与 --part 互斥：--parts 跑全部分段，--part n 只重跑第 n 段");
    process.exit(1);
  }
  return { submissionId, scriptPath: args[scriptIdx + 1], language: language.toLowerCase(), platform, parts, part };
}

/** 提交一段脚本给服务端合成，落盘 {name}.mp3 */
async function synthesize(
  config: EditorConfig,
  dir: string,
  name: string,
  segments: ScriptSegment[],
  language: string,
  platform: string | null,
  submissionId: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    submissionId,
    language,
    segments: segments.map(({ speaker, text }) => ({ speaker, text })),
  };
  if (platform) body.guestId = platform;
  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  console.log(`[tts] 段落 ${name} 合成：${segments.length} 段 / ${chars} 字 / ${language}${platform ? ` / 嘉宾 ${platform}` : ""}…`);
  const res = await api(config, "/v1/editor/tts", { method: "POST", body, expectJson: false });
  const audio = new Uint8Array(await (res as Response).arrayBuffer());
  const p = join(dir, `${name}.mp3`);
  writeFileSync(p, audio);
  console.log(`[tts] ✅ ${name} → ${p}（${(audio.length / 1024 / 1024).toFixed(2)}MB）`);
}

/** 按序拼接已有段落 → full.mp3（段间 0.6s 静音） */
function concatParts(dir: string, partNumbers: number[]): void {
  const silence = join(dir, "_silence.mp3");
  try {
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.6", "-q:a", "9", silence], { stdio: "ignore" });
  } catch {
    console.warn("[tts] 静音段生成失败（继续拼接）");
  }
  const items: string[] = [];
  partNumbers.forEach((n, i) => {
    items.push(join(dir, `part${n}.mp3`));
    if (i < partNumbers.length - 1 && existsSync(silence)) items.push(silence);
  });
  const listFile = join(dir, "_parts.txt");
  writeFileSync(listFile, items.map((p) => `file '${p}'`).join("\n"));
  const fullPath = join(dir, "full.mp3");
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "libmp3lame", "-q:a", "2", fullPath], { stdio: "ignore" });
  console.log(`[tts] 拼接 ${partNumbers.length} 段 → ${fullPath}`);
}

export async function tts(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, scriptPath, language, platform, parts, part } = parseArgs(args);
  const dir = draftDir(submissionId);
  const segments = readScript(scriptPath);
  const hasGuest = segments.some((s) => s.speaker === "guest");
  if (hasGuest && !platform) {
    console.error("[tts] 脚本含 guest 段，需要 --guest <platform>（嘉宾声线服务端配置）");
    process.exit(1);
  }

  // 默认：整集一次合成（兼容旧流程）
  if (!parts && part === null) {
    console.log(`[tts] 整集合成（multi speaker）：${segments.length} 段 / ${segments.reduce((n, s) => n + s.text.length, 0)} 字 / ${language}${platform ? ` / 嘉宾 ${platform}` : ""}`);
    await synthesize(config, dir, "full", segments, language, platform, submissionId);
    writeProgress(submissionId, "tts");
    console.log(`[tts] 下一步：pnpm editor merge ${submissionId} --language ${language}（intro + 整集 + outro）`);
    return;
  }

  // 分段模式：按段落的 part 字段分组（script-craft 生成时标注；缺省视为 part 1）
  const maxPart = segments.reduce((m, s) => Math.max(m, s.part ?? 1), 1);
  if (maxPart > 3) {
    console.error("[tts] part 仅支持 1-3（1=开场+定向 2=对谈 3=落点+收束）——脚本需由新版 script-craft 生成（段带 part 字段）");
    process.exit(1);
  }
  const targets = part !== null ? [part] : [1, 2, 3];
  for (const n of targets) {
    const partSegs = segments.filter((s) => (s.part ?? 1) === n);
    if (partSegs.length === 0) {
      console.warn(`[tts] part${n}（${PART_LABELS[n]}）无段落，跳过`);
      continue;
    }
    await synthesize(config, dir, `part${n}`, partSegs, language, platform, submissionId);
  }

  // 拼接已有段落 → full.mp3
  const existing = [1, 2, 3].filter((n) => existsSync(join(dir, `part${n}.mp3`)));
  if (existing.length >= 2) {
    concatParts(dir, existing);
  } else if (existing.length === 1) {
    copyFileSync(join(dir, `part${existing[0]}.mp3`), join(dir, "full.mp3"));
    console.log(`[tts] 仅 ${existing[0]} 段存在，full.mp3 = part${existing[0]}.mp3`);
  } else {
    console.warn("[tts] 无任何段落产物——先运行 pnpm editor tts ... --parts");
  }
  writeProgress(submissionId, "tts");
  console.log(`[tts] 下一步：pnpm editor merge ${submissionId} --language ${language}（intro + full + outro）`);
  console.log(`[tts] 单段重做：pnpm editor tts ${submissionId} --script ${scriptPath} --part <1|2|3>`);
}
