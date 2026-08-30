// 整集语音合成（本地直连 Fish Audio——标准流程，不绕服务端 /v1/editor/tts）：
//   pnpm editor tts <submissionId> --script <script.json> [--language zh] [--guest <platform>]
//   · 分段合成 --parts 为标准流程（片头插在点题与对谈之间，merge 需要 part1/2/3）；不带 --parts 时整集一次合成 → full.mp3（旧流程兜底）
//   · --parts：按 script.json 段落的 part 字段分 3 段独立合成（1=点题 2=对谈 3=落点+收束）
//     → 每段一次请求（part1/2/3.mp3）→ 拼接 full.mp3（段间 0.6s 静音）——长稿输入更短，单段可独立重做
//   · --part <n>：只重跑第 n 段（part{n}.mp3）→ 与已有段落重新拼接 full.mp3（省配额）
//   · 音源：host = 投稿人采样（R2 key = detail voiceSamples[].audioUrl，转录 = transcript）；
//     guest = 嘉宾声线（R2 key = voice-samples audioKey，转录 = transcript）；本地 SigV4 直取 R2 + ffmpeg 转 wav
//   · 合成：multi speaker（<|speaker:N|> 标签 + references 2D，实测两方音色正确）或纯 host 单说话人（references 1D）
//   · 密钥：FISH_API_KEY / R2_* 从 .dailog-editor/.env 读取（gitignored，chmod 600）
//   → 合成：pnpm editor merge（intro + full + outro）
import { writeFileSync, readFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import type { EditorConfig } from "./lib.js";
import { api, tryApi, draftDir, readScript, writeProgress, type ScriptSegment } from "./lib.js";
import { synthesizeMultiSpeaker, synthesizeSingle } from "./fish.js";
import { getR2Object } from "./r2.js";

/** 平台枚举（guests 表；--guest 取值） */
const PLATFORMS = ["claude", "chatgpt", "deepseek", "gemini", "kimi", "doubao", "tongyi", "perplexity", "grok"];
/** part 1-3 分段标签（1=点题 2=对谈 3=落点+收束） */
const PART_LABELS = ["", "点题", "对谈", "落点+收束"];
/** 参考音频转录占位文本（采样无转录时用；转录准确度影响克隆质量） */
const REF_TRANSCRIPT = "你好，欢迎收听 dailog。这是参考音频的转录文本，用于声音克隆测试。";

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
      console.error("[tts] --part 取值 1|2|3（1=点题 2=对谈 3=落点+收束）");
      process.exit(1);
    }
  }
  if (parts && part !== null) {
    console.error("[tts] --parts 与 --part 互斥：--parts 跑全部分段，--part n 只重跑第 n 段");
    process.exit(1);
  }
  return { submissionId, scriptPath: args[scriptIdx + 1], language: language.toLowerCase(), platform, parts, part };
}

interface GuestVoiceRow {
  guestId: string;
  guestName?: string;
  language: string;
  audioKey: string;
  transcript: string | null;
}

/** 解析有效 guestId（音色替换，本地决策、零服务端依赖）：
 *  目标嘉宾无声线 → 用系统内其他嘉宾同语种音色兜底——替换音色、不替换嘉宾名字（脚本里的 guest 称呼不变）。
 *  返回结构化 note（ASCII）：guest-voice-replacement:<来源嘉宾>:<语种>；无替换返回 null。 */
async function resolveGuestId(
  config: EditorConfig,
  platform: string,
  language: string,
): Promise<{ guestId: string; note: string | null }> {
  const samples = (await tryApi(config, "/v1/editor/guests/voice-samples").catch(() => null)) as GuestVoiceRow[] | null;
  if (!samples || samples.length === 0) return { guestId: platform, note: null };
  const mine = samples.filter((s) => s.guestId === platform);
  const pickMine = (lang: string) => mine.find((s) => s.language === lang) ?? null;
  if (pickMine(language) || (language !== "en" ? pickMine("en") : null)) return { guestId: platform, note: null };
  const other = samples.filter((s) => s.guestId !== platform);
  const pickOther = (lang: string) => other.find((s) => s.language === lang) ?? null;
  const fallback = pickOther(language) ?? (language !== "en" ? pickOther("en") : null) ?? other[0] ?? null;
  if (!fallback) return { guestId: platform, note: null };
  return { guestId: fallback.guestId, note: `guest-voice-replacement:${fallback.guestId}:${fallback.language}` };
}

/** ffmpeg 转 44100Hz 单声道 WAV（Fish 参考音频格式）；失败抛错 */
function toWav(input: Uint8Array, label: string): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "dailog-tts-"));
  const inPath = join(dir, "in.bin");
  const outPath = join(dir, "out.wav");
  try {
    writeFileSync(inPath, input);
    execFileSync("ffmpeg", ["-y", "-i", inPath, "-ar", "44100", "-ac", "1", outPath], { stdio: "ignore" });
    return new Uint8Array(readFileSync(outPath));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface VoiceRef {
  audio: Uint8Array;
  text: string;
}

/** 取 host 采样（投稿人）：detail voiceSamples 按 语言 → en → 最近 匹配；R2 直取 + 转 wav */
async function resolveHostRef(config: EditorConfig, submissionId: string, language: string): Promise<VoiceRef> {
  const detail = (await api(config, `/v1/editor/submissions/${submissionId}`)) as {
    voiceSamples?: Array<{ audioUrl: string; transcript: string | null; language: string; status: string }>;
  };
  const samples = (detail.voiceSamples ?? []).filter((s) => s.status === "ready");
  const byLang = (lang: string) => samples.find((s) => s.language === lang) ?? null;
  const sample = byLang(language) ?? (language !== "en" ? byLang("en") : null) ?? samples[0] ?? null;
  if (!sample) {
    console.error(`[tts] 投稿 ${submissionId} 无 ready 声音采样（无法克隆主持人音色）`);
    process.exit(1);
  }
  const bytes = await getR2Object(config, sample.audioUrl);
  return { audio: toWav(bytes, "host"), text: sample.transcript ?? REF_TRANSCRIPT };
}

/** 取 guest 声线（嘉宾）：voice-samples 表按 guestId/语种匹配（音色替换同 resolveGuestId）；R2 直取 + 转 wav */
async function resolveGuestRef(config: EditorConfig, guestId: string, language: string): Promise<VoiceRef> {
  const samples = (await tryApi(config, "/v1/editor/guests/voice-samples").catch(() => null)) as GuestVoiceRow[] | null;
  if (!samples || samples.length === 0) {
    console.error(`[tts] 嘉宾 ${guestId} 无可用声线（voice-samples 为空）——guest-voice 上传声线后重跑`);
    process.exit(1);
  }
  const mine = samples.filter((s) => s.guestId === guestId);
  const pick = (lang: string) => mine.find((s) => s.language === lang) ?? null;
  const row = pick(language) ?? (language !== "en" ? pick("en") : null) ?? mine[0] ?? null;
  if (!row) {
    console.error(`[tts] 嘉宾 ${guestId} 无 ${language}（或 en）声线——guest-voice 上传声线后重跑`);
    process.exit(1);
  }
  const bytes = await getR2Object(config, row.audioKey);
  return { audio: toWav(bytes, `guest:${guestId}`), text: row.transcript ?? REF_TRANSCRIPT };
}

/** 提交一段脚本给 Fish 本地合成，落盘 {name}.mp3 */
async function synthesize(
  config: EditorConfig,
  dir: string,
  name: string,
  segments: ScriptSegment[],
  language: string,
  platform: string | null,
  submissionId: string,
): Promise<void> {
  const hasGuest = segments.some((s) => s.speaker === "guest");
  // 音色替换（本地决策）：目标嘉宾无声线 → 用系统内其他嘉宾音色，guestId 换发；嘉宾名字不变
  let effectivePlatform = platform;
  let voiceNote: string | null = null;
  if (platform && hasGuest) {
    const resolved = await resolveGuestId(config, platform, language);
    effectivePlatform = resolved.guestId;
    voiceNote = resolved.note;
  }

  const hostRef = await resolveHostRef(config, submissionId, language);
  let guestRef: VoiceRef | null = null;
  if (hasGuest) {
    if (!effectivePlatform) {
      console.error("[tts] 脚本含 guest 段，需要 --guest <platform>（嘉宾声线服务端配置）");
      process.exit(1);
    }
    guestRef = await resolveGuestRef(config, effectivePlatform, language);
  }

  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  console.log(`[tts] 段落 ${name} 合成：${segments.length} 段 / ${chars} 字 / ${language}${platform ? ` / 嘉宾 ${platform}` : ""}…`);
  if (voiceNote) {
    const m = /^guest-voice-replacement:(.+):(.+)$/.exec(voiceNote);
    if (m) console.log(`[tts] ⚠️ 音色替换：${platform} 无声线，使用 ${m[1]}（${m[2]}）音色——嘉宾名字不变`);
    else console.log(`[tts] ⚠️ ${voiceNote}`);
  }

  const t0 = Date.now();
  const audio = hasGuest && guestRef
    ? await synthesizeMultiSpeaker(
        config,
        segments.map((s) => ({ speaker: s.speaker === "host" ? 0 : 1, text: s.text })),
        hostRef,
        guestRef,
      )
    : await synthesizeSingle(config, segments.map((s) => s.text).join(""), hostRef);

  const p = join(dir, `${name}.mp3`);
  writeFileSync(p, audio);
  console.log(`[tts] ✅ ${name} → ${p}（${(audio.length / 1024 / 1024).toFixed(2)}MB，${(((Date.now() - t0) / 1000)).toFixed(0)}s）`);
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
    console.error("[tts] part 仅支持 1-3（1=点题 2=对谈 3=落点+收束）——脚本需由新版 script-craft 生成（段带 part 字段）");
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
