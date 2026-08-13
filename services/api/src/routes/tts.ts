// 统一 TTS 端点（编辑本地不直连 Fish Audio——密钥只在服务端）：
//   POST /v1/editor/tts（multipart，requireRole editor）
//     · speaker=host ：服务端从 voice_samples 取投稿人采样（R2 webm）→ ffmpeg 转 wav + 表内 transcript
//     · speaker=guest：编辑上传声线资源文件（guestAudio，工程 assets 里的平台声线/统一声线）+ 可选 guestTranscript
//   → Fish 合成（msgpack references 内联零样本克隆）→ mp3 返回（audio/mpeg）
// 单段一次请求（编辑逐段调用，失败可重试单段）。

import { Hono } from "hono";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireRole, type AuthEnv } from "../middleware/auth";
import type { Repos } from "../repo";
import type { TtsClient } from "../tts/client";

export interface TtsDeps {
  repo: Repos;
  storage: { get(key: string): Promise<Uint8Array> };
  /** @ffmpeg-installer 二进制路径（webm/mp3 → wav，Fish 参考音频要求 wav） */
  ffmpegPath: string;
  /** Fish 客户端（FISH_API_KEY 未配置 → null，端点 503） */
  fish: TtsClient | null;
}

const MAX_TEXT_CHARS = 2000; // 单段台词上限（防滥用）

/** ffmpeg 转 wav（Fish 参考音频要求 wav 44.1k mono） */
function toWav(ffmpegPath: string, input: Uint8Array): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "dailog-tts-"));
  const inPath = join(dir, "in.bin");
  const outPath = join(dir, "out.wav");
  writeFileSync(inPath, input);
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-y", "-i", inPath, "-ar", "44100", "-ac", "1", outPath], { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => {
      try {
        if (code !== 0) return reject(new Error(`ffmpeg 转码失败（exit ${code}）`));
        resolve(new Uint8Array(readFileSync(outPath)));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

export function ttsRoutes(deps: TtsDeps) {
  const app = new Hono<AuthEnv>();
  app.use("/v1/editor/tts", requireRole("editor"));

  app.post("/v1/editor/tts", async (c) => {
    if (!deps.fish) {
      return c.json({ error: "tts_not_configured", detail: "服务端未配置 FISH_API_KEY" }, 503);
    }
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: "invalid_body" }, 400);
    const submissionId = typeof form.get("submissionId") === "string" ? (form.get("submissionId") as string).trim() : "";
    const text = typeof form.get("text") === "string" ? (form.get("text") as string).trim() : "";
    const speaker = typeof form.get("speaker") === "string" ? (form.get("speaker") as string) : "host";
    const language = typeof form.get("language") === "string" && /^[a-z]{2,3}$/i.test(form.get("language") as string)
      ? (form.get("language") as string).toLowerCase()
      : "zh";
    if (!submissionId) return c.json({ error: "submission_required" }, 400);
    if (!text) return c.json({ error: "text_required", detail: "缺少台词文本" }, 400);
    if (text.length > MAX_TEXT_CHARS) return c.json({ error: "text_too_long", detail: `单段台词超过 ${MAX_TEXT_CHARS} 字` }, 400);
    if (speaker !== "host" && speaker !== "guest") return c.json({ error: "invalid_speaker", detail: "speaker 只能 host/guest" }, 400);

    const detail = await deps.repo.submissions.getDetail(submissionId);
    if (!detail) return c.json({ error: "not_found" }, 404);

    let referenceAudio: Uint8Array;
    let transcript: string | null;

    if (speaker === "host") {
      // 投稿人采样：服务端取（voice_samples 表 + R2），编辑无需上传
      const sample = await deps.repo.episodes.getVoiceSampleByLanguage(detail.userId, language);
      if (!sample) {
        return c.json({ error: "no_voice_sample", detail: `投稿人无 ${language} 声音采样` }, 422);
      }
      const bytes = await deps.storage.get(sample.audioUrl).catch(() => null);
      if (!bytes) return c.json({ error: "no_voice_sample", detail: "采样音频读取失败" }, 422);
      referenceAudio = bytes;
      transcript = sample.transcript;
    } else {
      // 嘉宾声线：服务端配置（guest_voice_samples 表 + R2——编辑用 guest-voice 命令上传管理），
      // 按 guestId + 语言取用（同语种优先，兜底任意语种）
      const guestId = typeof form.get("guestId") === "string" ? (form.get("guestId") as string).trim() : "";
      if (!guestId) {
        return c.json({ error: "guest_required", detail: "guest 段需要 guestId（嘉宾声线在服务端配置）" }, 400);
      }
      const sample = (await deps.repo.guests.voiceSampleByLanguage(guestId, language).catch(() => null))
        ?? (await deps.repo.guests.voiceSampleAny(guestId).catch(() => null));
      if (!sample) {
        return c.json({ error: "no_guest_voice", detail: `嘉宾 ${guestId} 无 ${language} 声线（服务端未配置——用 guest-voice 命令上传）` }, 422);
      }
      const bytes = await deps.storage.get(sample.audioKey).catch(() => null);
      if (!bytes) return c.json({ error: "no_guest_voice", detail: "嘉宾声线音频读取失败" }, 422);
      referenceAudio = bytes;
      transcript = sample.transcript;
    }

    // webm/mp3 → wav（Fish 参考音频要求 wav）
    let wav: Uint8Array;
    try {
      wav = await toWav(deps.ffmpegPath, referenceAudio);
    } catch (e) {
      return c.json({ error: "audio_decode_failed", detail: (e as Error).message }, 422);
    }

    try {
      const mp3 = await deps.fish.synthesizeSingle({
        text,
        referenceAudio: wav,
        referenceAudioTranscript: transcript ?? undefined,
      });
      return new Response(mp3 as unknown as BodyInit, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=60" },
      });
    } catch (e) {
      return c.json({ error: "tts_failed", detail: (e as Error).message.slice(0, 300) }, 502);
    }
  });

  return app;
}
