// 逐段合成（统一 TTS 端点——编辑本地不直连 Fish Audio）：
//   POST /v1/editor/tts（multipart）逐段调用：
//     · speaker=host  → 服务端取投稿人采样（R2）+ 表内 transcript，无需编辑上传
//     · speaker=guest → 上传声线资源文件（工程 assets 的平台声线/统一声线，mp3）+ 配套 transcript
//   服务端 ffmpeg 转 wav + Fish 合成 → mp3 返回
// 每段一个请求（稳妥，失败可重试单段）；产物 drafts/{submissionId}/seg-{i}.mp3 + segments.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, draftDir, readScript, writeProgress, type ScriptSegment } from "./lib.js";

/** 平台枚举（guests 表；--guest 取值） */
const PLATFORMS = ["claude", "chatgpt", "deepseek", "gemini", "kimi", "doubao", "tongyi", "perplexity"];

function parseArgs(args: string[]): { submissionId: string; scriptPath: string; language: string; platform: string | null } {
  const submissionId = args[0];
  const scriptIdx = args.indexOf("--script");
  const langIdx = args.indexOf("--language");
  const guestIdx = args.indexOf("--guest");
  if (!submissionId || scriptIdx < 0 || !args[scriptIdx + 1]) {
    console.error("用法：pnpm editor tts <submissionId> --script <script.json> [--language zh|en] [--guest <platform>]");
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
  return { submissionId, scriptPath: args[scriptIdx + 1], language: language.toLowerCase(), platform };
}

/** 调统一 TTS 端点合成单段 → mp3 字节（guest 声线由服务端配置取用——guestId 指定） */
async function synthesizeSegment(config: EditorConfig, submissionId: string, seg: ScriptSegment, language: string, platform: string | null): Promise<Uint8Array> {
  const form = new FormData();
  form.append("submissionId", submissionId);
  form.append("text", seg.text);
  form.append("speaker", seg.speaker);
  form.append("language", language);
  if (seg.speaker === "guest") {
    if (!platform) throw new Error("guest 段需要 --guest <platform>（嘉宾声线在服务端配置）");
    form.append("guestId", platform);
  }
  const res = await api(config, "/v1/editor/tts", { method: "POST", formData: form, expectJson: false });
  return new Uint8Array(await (res as Response).arrayBuffer());
}

export async function tts(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, scriptPath, language, platform } = parseArgs(args);
  const dir = draftDir(submissionId);
  const segments = readScript(scriptPath);

  console.log(`[tts] 开始合成 ${segments.length} 段（统一端点 /v1/editor/tts；host 采样与 guest 声线均由服务端取用）`);
  const index: Array<{ i: number; speaker: string; file: string; chars: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.speaker === "guest" && !platform) {
      console.warn(`[tts] 跳过 ${i} 号 guest 段（guest 段需要 --guest <platform>）`);
      continue;
    }
    process.stdout.write(`[tts] 段 ${i + 1}/${segments.length}（${seg.speaker}，${seg.text.length} 字）… `);
    try {
      const audio = await synthesizeSegment(config, submissionId, seg, language, platform);
      const file = `seg-${String(i).padStart(2, "0")}.mp3`;
      writeFileSync(join(dir, file), audio);
      index.push({ i, speaker: seg.speaker, file, chars: seg.text.length });
      console.log(`${(audio.length / 1024).toFixed(0)}KB ✅`);
    } catch (e) {
      console.error(`失败：${(e as Error).message}`);
      console.error(`  重试：pnpm editor tts ${submissionId} --script ${scriptPath} --language ${language}${platform ? ` --guest ${platform}` : ""}`);
      process.exit(1);
    }
  }
  writeFileSync(join(dir, "segments.json"), JSON.stringify(index, null, 2));
  writeProgress(submissionId, "tts");
  console.log(`[tts] 完成 ${index.length} 段 → ${dir}（合成：pnpm editor merge ${submissionId} --language ${language}）`);
}
