// 统一 TTS 端点（multi speaker——官方多说话人接口，一次调用合成整集）：
//   POST /v1/editor/tts（JSON）
//   body: { submissionId, language, guestId?, segments: [{speaker: "host"|"guest", text}] }
//   → host 采样（voice_samples + R2 → wav）+ guest 声线（guest_voice_samples + R2 → wav）
//   → 有 guest 段：multi speaker（text 内嵌 <|speaker:0|> host / <|speaker:1|> guest，
//     references 2D 按 speaker 序号；Fish 官方接口，msgpack 内联零样本克隆）
//   → 纯 host：single（整集单说话人）
//   → 返回整集 mp3（audio/mpeg）
// 编辑本地不直连 Fish——key 只在服务端；guest 声线/称呼服务端配置（guests 管理端点）。

import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireRole, type AuthEnv } from "../middleware/auth";
import type { Repos } from "../repo";
import type { TtsClient } from "../tts/client";
import type { AudioStorage } from "../storage";

export interface TtsDeps {
  repo: Repos;
  storage: AudioStorage;
  /** @ffmpeg-installer 二进制路径（webm/mp3 → wav，Fish 参考音频要求 wav） */
  ffmpegPath: string;
  /** Fish 客户端（FISH_API_KEY 未配置 → null，端点 503） */
  fish: TtsClient | null;
}

const MAX_SEGMENTS = 200; // 脚本段数上限
const MAX_TEXT_CHARS = 4000; // 单段台词上限

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
  const app = new OpenAPIHono<AuthEnv>();
  const Err = z.object({ error: z.string() });
  app.use("/v1/editor/tts", requireRole("editor"));

  const r1 = createRoute({
    method: "post",
    path: "/v1/editor/tts",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/editor/tts" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    if (!deps.fish) {
      return c.json({ error: "tts_not_configured", detail: "服务端未配置 FISH_API_KEY" }, 503);
    }
    const body = (await c.req.json().catch(() => null)) as {
      submissionId?: unknown;
      language?: unknown;
      guestId?: unknown;
      segments?: unknown;
    } | null;
    if (!body) return c.json({ error: "invalid_body" }, 400);
    const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
    const language = typeof body.language === "string" && /^[a-z]{2,3}$/i.test(body.language)
      ? body.language.toLowerCase()
      : "zh";
    const guestId = typeof body.guestId === "string" && body.guestId.trim() ? body.guestId.trim() : null;
    if (!submissionId) return c.json({ error: "submission_required" }, 400);
    if (!Array.isArray(body.segments) || body.segments.length === 0) {
      return c.json({ error: "segments_required", detail: "缺少 segments（完整脚本）" }, 400);
    }
    if (body.segments.length > MAX_SEGMENTS) return c.json({ error: "segments_too_many" }, 400);
    // 校验并规范化 segments（host→0 / guest→1）
    const segments: Array<{ speaker: 0 | 1; text: string }> = [];
    for (const seg of body.segments) {
      const s = seg as { speaker?: unknown; text?: unknown };
      if (s?.speaker !== "host" && s?.speaker !== "guest") {
        return c.json({ error: "invalid_segment", detail: "speaker 只能 host/guest" }, 400);
      }
      const text = typeof s.text === "string" ? s.text.trim() : "";
      if (!text) return c.json({ error: "invalid_segment", detail: "segment text 为空" }, 400);
      if (text.length > MAX_TEXT_CHARS) return c.json({ error: "text_too_long", detail: `单段台词超过 ${MAX_TEXT_CHARS} 字` }, 400);
      segments.push({ speaker: s.speaker === "host" ? 0 : 1, text });
    }
    const hasGuest = segments.some((s) => s.speaker === 1);
    if (hasGuest && !guestId) {
      return c.json({ error: "guest_required", detail: "脚本含 guest 段，需要 guestId（嘉宾声线服务端配置）" }, 400);
    }

    const detail = await deps.repo.submissions.getDetail(submissionId);
    if (!detail) return c.json({ error: "not_found" }, 404);

    // host 参考（投稿人采样）：按脚本语言匹配 → 英文采样兜底 → 最近一条采样兜底
    // （架构支持多语种；无对应语种时降级，保证能出声音）
    const samples = detail.voiceSamples; // getDetail 已过滤 ready、按最近排序
    const byLang = (lang: string) => samples.find((s) => s.language === lang) ?? null;
    const hostSample = byLang(language) ?? (language !== "en" ? byLang("en") : null) ?? samples[0] ?? null;
    if (!hostSample) {
      return c.json({ error: "no_voice_sample", detail: `投稿人无声音采样` }, 422);
    }
    const hostBytes = await deps.storage.get(hostSample.audioUrl).then((r) => r.data).catch(() => null);
    if (!hostBytes) return c.json({ error: "no_voice_sample", detail: "采样音频读取失败" }, 422);

    // guest 参考（声线服务端配置：同语种优先 → 未定义语种统一英文兜底）
    let guestSample: { audioKey: string; transcript: string | null } | null = null;
    if (hasGuest) {
      guestSample = (await deps.repo.guests.voiceSampleByLanguage(guestId!, language).catch(() => null))
        ?? (language !== "en" ? await deps.repo.guests.voiceSampleByLanguage(guestId!, "en").catch(() => null) : null);
      if (!guestSample) {
        return c.json({ error: "no_guest_voice", detail: `嘉宾 ${guestId} 无 ${language}（或 en）声线（服务端未配置——用 guest-voice 命令上传）` }, 422);
      }
    }

    // webm/mp3 → wav
    let hostWav: Uint8Array;
    let guestWav: Uint8Array | null = null;
    try {
      hostWav = await toWav(deps.ffmpegPath, hostBytes);
      if (guestSample) {
        const guestBytes = await deps.storage.get(guestSample.audioKey).then((r) => r.data).catch(() => null);
        if (!guestBytes) return c.json({ error: "no_guest_voice", detail: "嘉宾声线音频读取失败" }, 422);
        guestWav = await toWav(deps.ffmpegPath, guestBytes);
      }
    } catch (e) {
      return c.json({ error: "audio_decode_failed", detail: (e as Error).message }, 422);
    }

    try {
      let mp3: Uint8Array;
      if (hasGuest) {
        // multi speaker：text 内嵌 <|speaker:N|> 标签 + references 2D（官方多说话人接口）
        mp3 = await deps.fish.synthesizeMultiSpeaker({
          segments,
          referenceAudios: [hostWav, guestWav!],
          transcripts: [hostSample.transcript, guestSample!.transcript],
        });
      } else {
        // 纯 host：整集单说话人
        mp3 = await deps.fish.synthesizeSingle({
          text: segments.map((s) => s.text).join(""),
          referenceAudio: hostWav,
          referenceAudioTranscript: hostSample.transcript ?? undefined,
        });
      }
      return new Response(mp3 as unknown as BodyInit, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=60" },
      });
    } catch (e) {
      return c.json({ error: "tts_failed", detail: (e as Error).message.slice(0, 300) }, 502);
    }
  }) as unknown as RouteHandler<typeof r1, AuthEnv>);

  return app;
}
