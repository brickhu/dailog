// 整集语音合成（multi speaker——官方多说话人接口，一次调用合成完整脚本）：
//   pnpm editor tts <submissionId> --script <script.json> [--language zh] [--guest <platform>]
//   → POST /v1/editor/tts（JSON：submissionId + language + guestId + 完整 segments）
//   → 服务端：host 采样（R2）+ guest 声线（guest_voice_samples）→ multi speaker 一次合成
//   → 产物 drafts/{submissionId}/full.mp3（整集，含 host/guest 交替）
//   → 合成：pnpm editor merge（intro + full + outro）
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

export async function tts(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, scriptPath, language, platform } = parseArgs(args);
  const dir = draftDir(submissionId);
  const segments = readScript(scriptPath);
  const hasGuest = segments.some((s) => s.speaker === "guest");
  if (hasGuest && !platform) {
    console.error("[tts] 脚本含 guest 段，需要 --guest <platform>（嘉宾声线服务端配置）");
    process.exit(1);
  }

  // 一次请求：完整脚本 → 服务端 multi speaker 合成（host 采样 + guest 声线服务端取用）
  const body: Record<string, unknown> = {
    submissionId,
    language,
    segments,
  };
  if (platform) body.guestId = platform;

  const chars = segments.reduce((n, s) => n + s.text.length, 0);
  console.log(`[tts] 整集合成（multi speaker）：${segments.length} 段 / ${chars} 字 / ${language}${platform ? ` / 嘉宾 ${platform}` : ""}`);
  console.log(`[tts] host 采样与${platform ? " guest 声线" : ""}由服务端取用，一次调用…`);

  const res = await api(config, "/v1/editor/tts", { method: "POST", body, expectJson: false });
  const audio = new Uint8Array(await (res as Response).arrayBuffer());
  const fullPath = join(dir, "full.mp3");
  writeFileSync(fullPath, audio);
  writeProgress(submissionId, "tts");
  console.log(`[tts] ✅ 整集合成完成 → ${fullPath}（${(audio.length / 1024 / 1024).toFixed(2)}MB）`);
  console.log(`[tts] 下一步：pnpm editor merge ${submissionId} --language ${language}（intro + 整集 + outro）`);
}
