import { Hono } from "hono";
import type { AudioStorage } from "../storage";

export interface VoiceSampleRow {
  id?: string;          // 仅 GET 回读填充（前端 sampleId）
  language: string;     // 采样语种（一人多语种各一条）
  userId: string;
  audioUrl: string;   // storage key
  /** 参考音频转录文本（用户朗读的固定文案；零样本克隆用） */
  transcript: string | null;
  duration: number;
  status: "ready" | "failed";
  createdAt?: Date;   // 仅 GET 回读填充
}

export interface VoiceDeps {
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
  /** 工作台回读最新样本（onboarding 守卫/设置页）；无记录返回 null */
  getVoiceSample?(userId: string): Promise<VoiceSampleRow | null>;
  storage: AudioStorage;
}

// 自带 /api 前缀（与 polish/generate/job 路由一致，见 app.ts 挂载说明）：测试对裸 app 请求 /api/...
// 样本直传模式：上传只保存录音文件，不训练音色模型；生成时由 TTS 管线以 referenceAudio 零样本方式使用
export function voiceRoutes(deps: VoiceDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.get("/v1/me/voice-sample", async (c) => {
    const userId = c.get("userId") as string;
    const row = await deps.getVoiceSample?.(userId);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      id: row.id ?? null,
      status: row.status,
      duration: row.duration,
      createdAt: row.createdAt,
    });
  });

  /** 采样音频流（设置页播放用）：读 storage key 返回 webm */
  app.get("/v1/me/voice-sample/audio", async (c) => {
    const userId = c.get("userId") as string;
    const row = await deps.getVoiceSample?.(userId);
    if (!row) return c.json({ error: "not_found" }, 404);
    const bytes = await deps.storage.get(row.audioUrl);
    if (!bytes) return c.json({ error: "not_found" }, 404);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "audio/webm",
        "Cache-Control": "private, max-age=300",
      },
    });
  });

  app.post("/v1/me/voice-sample", async (c) => {
    const userId = c.get("userId") as string;
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return c.json({ error: "file_required" }, 400);
    // 转录文本（用户朗读的固定文案，前端随上传提交；零样本克隆质量依赖它）
    const transcript = typeof form?.get("transcript") === "string" ? (form.get("transcript") as string).trim() || null : null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // 采样语种（form 字段；缺省 zh）——一人多语种各一条
    const language = typeof form?.get("language") === "string" && /^[a-z]{2,3}$/i.test(form.get("language") as string)
      ? (form.get("language") as string).toLowerCase()
      : "zh";
    // R2 目录规划：voices/{userId}/{language}.webm
    const key = `voices/${userId}/${language}.webm`;
    await deps.storage.put(key, bytes);
    await deps.saveVoiceSample({ userId, language, audioUrl: key, transcript, duration: 0, status: "ready" });
    return c.json({ ok: true });
  });
  return app;
}
