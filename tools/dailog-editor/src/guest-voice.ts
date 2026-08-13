// 嘉宾声线管理（服务端配置）：上传/更新嘉宾品牌声线
//   pnpm editor guest-voice <guestId> --audio <file.mp3> [--language zh] [--transcript "朗读文案"]
//   → POST /v1/editor/guests/:guestId/voice-sample（multipart）→ R2 + guest_voice_samples 表
//   之后 tts 的 guest 段（--guest <platform>）由服务端自动取用该声线
import { readFileSync } from "node:fs";
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";

export async function guestVoice(config: EditorConfig, args: string[]): Promise<void> {
  const guestId = args[0];
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  const audio = take("--audio");
  const language = take("--language") ?? "zh";
  const transcript = take("--transcript") ?? undefined;
  if (!guestId || !audio) {
    console.error("用法：pnpm editor guest-voice <guestId> --audio <file.mp3> [--language zh] [--transcript \"朗读文案\"]");
    process.exit(1);
  }
  const bytes = readFileSync(audio);
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), audio.split("/").pop() ?? "guest.mp3");
  form.append("language", language);
  if (transcript) form.append("transcript", transcript);

  await api(config, `/v1/editor/guests/${guestId}/voice-sample`, { method: "POST", formData: form });
  console.log(`[guest-voice] ✅ 嘉宾 ${guestId} ${language} 声线已配置（${(bytes.length / 1024).toFixed(0)}KB${transcript ? " + 转录" : ""}）`);
  console.log(`[guest-voice]   tts 时用 --guest ${guestId} 即自动取用（服务端配置）`);
}
