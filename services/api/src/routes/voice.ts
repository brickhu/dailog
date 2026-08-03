import { Hono } from "hono";
import type { TtsClient } from "../tts/client";
import type { AudioStorage } from "../storage";

export interface VoiceSampleRow {
  userId: string;
  audioUrl: string;   // storage key
  referenceId: string | null;
  duration: number;
  status: "ready" | "failed";
  createdAt?: Date;   // 仅 GET 回读填充
}

export interface VoiceDeps {
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
  /** 工作台回读最新样本（onboarding 守卫/设置页）；无记录返回 null */
  getVoiceSample?(userId: string): Promise<VoiceSampleRow | null>;
  tts: TtsClient | null; // null = 未配置（FISH_API_KEY 空）
  storage: AudioStorage;
}

// 自带 /api 前缀（与 polish/generate/job 路由一致，见 app.ts 挂载说明）：测试对裸 app 请求 /api/...
export function voiceRoutes(deps: VoiceDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.get("/api/me/voice-sample", async (c) => {
    const userId = c.get("userId") as string;
    const row = await deps.getVoiceSample?.(userId);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({
      status: row.status,
      referenceId: row.referenceId,
      duration: row.duration,
      createdAt: row.createdAt,
    });
  });

  app.post("/api/me/voice-sample", async (c) => {
    const userId = c.get("userId") as string;
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return c.json({ error: "file_required" }, 400);
    if (!deps.tts) return c.json({ error: "tts_not_configured" }, 503);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = `audio/voices/${userId}.wav`;
    await deps.storage.put(key, bytes);
    try {
      const { id } = await deps.tts.createVoiceModel({ audio: bytes, name: userId });
      await deps.saveVoiceSample({ userId, audioUrl: key, referenceId: id, duration: 0, status: "ready" });
      return c.json({ referenceId: id });
    } catch (e) {
      await deps.saveVoiceSample({ userId, audioUrl: key, referenceId: null, duration: 0, status: "failed" });
      return c.json({ error: "voice_model_failed", detail: String(e instanceof Error ? e.message : e) }, 502);
    }
  });
  return app;
}
