import { Hono } from "hono";
import type { VoiceSampleRow } from "./voice";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

export interface EpisodesRepo {
  listEpisodes(userId: string): Promise<Array<{ id: string; title: string | null; status: string; platform: string | null; createdAt: Date }>>;
  /** userId 传入时强制归属过滤（防 IDOR） */
  getEpisode(id: string, userId?: string): Promise<{ id: string; userId: string; title: string | null; status: string } | null>;
  /** 工作台试听：返回 episode 音频 storage key（归属过滤，无音频返回 null） */
  getEpisodeAudio(id: string, userId: string): Promise<string | null>;
  saveScript(episodeId: string, version: number, segments: ScriptSegment[]): Promise<{ episodeId: string; version: number; segments: ScriptSegment[] }>;
  getLatestScript(episodeId: string): Promise<{ version: number; segments: ScriptSegment[] } | null>;
  /** 通过 episodes.import_id 定位来源导入（对话内容在 R2，imports/{id}.dialogue.json，由调用方经 storage 读）；userId 强制归属过滤（防 IDOR） */
  getImportedDialogue(episodeId: string, userId: string): Promise<{ importId: string } | null>;
  /** 节目页"查看原文"预留：公开只读，仅已发布（is_public=true）节目返回对话来源 meta（内容在 R2）；未发布/无导入 → null */
  getPublishedDialogue(episodeId: string): Promise<{
    importId: string;
    platform: string;
    sourceTitle: string | null;
    sourceUrl: string;
  } | null>;
  setPublished(id: string): Promise<void>;
  /** 润色完成后持久化对话语言（runner 选片头片尾用） */
  setEpisodeLanguage(id: string, language: string): Promise<void>;
  /** 对话级润色计数（episodes.polish_count，仅计 LLM 润色保存） */
  getPolishCount(episodeId: string): Promise<number>;
  /** LLM 润色保存后 +1（savePolished 内部调用；PUT script 手动保存不计） */
  incrementPolishCount(episodeId: string): Promise<void>;
  /** 生成管线：episode 归属用户（Task 7 tts 阶段） */
  getEpisodeUserId(episodeId: string): Promise<string | null>;
  /** 生成管线：episode 语言（Task 7 tts 阶段加载，Task 8 merge 使用） */
  getEpisodeLanguage(episodeId: string): Promise<string | null>;
  /** 生成管线：用户最新 ready 录音样本的训练音色模型 id（voice_samples.reference_id，无则零样本 fallback） */
  getHostModelId(userId: string): Promise<string | null>;
  /** 生成管线：用户最新 ready 录音样本的 storage key（voice_samples.audio_url，storage.get 读字节） */
  getVoiceSampleKey(userId: string): Promise<string | null>;
  /** 录音样本 upsert（同 user 覆盖旧行：先删后插，保证 getHostModelId/getVoiceSampleKey 取到最新） */
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
  /** 工作台回读最新样本（onboarding 守卫/设置页）；无记录返回 null */
  getVoiceSample(userId: string): Promise<VoiceSampleRow | null>;
  /** 频道开通时间（授权码激活）；null = 未开通（生成/发布被挡） */
  getChannelActivatedAt(userId: string): Promise<Date | null>;
}

export function episodesRoutes(repo: EpisodesRepo, getUserId: (c: unknown) => string, storage?: { get(key: string): Promise<Uint8Array> }) {
  const app = new Hono();
  app.get("/episodes", async (c) => {
    const episodes = await repo.listEpisodes(getUserId(c));
    return c.json(episodes);
  });
  // 工作台试听：归属校验后流式返回音频（fs/r2 统一走 storage.get）
  app.get("/episodes/:id/audio", async (c) => {
    const userId = getUserId(c);
    const key = await repo.getEpisodeAudio(c.req.param("id"), userId);
    if (!key || !storage) return c.json({ error: "not_found" }, 404);
    try {
      const data = await storage.get(key);
      return new Response(new Uint8Array(data), { headers: { "Content-Type": "audio/mpeg" } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });
  app.get("/episodes/:id", async (c) => {
    const ep = await repo.getEpisode(c.req.param("id"), getUserId(c));
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(ep);
  });
  // 润色编辑器加载：最新脚本；从未生成过返回 404（前端据此触发 polish）
  app.get("/episodes/:id/script", async (c) => {
    const ep = await repo.getEpisode(c.req.param("id"), getUserId(c));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const script = await repo.getLatestScript(c.req.param("id"));
    if (!script) return c.json({ error: "not_found" }, 404);
    return c.json(script);
  });
  app.put("/episodes/:id/script", async (c) => {
    const ep = await repo.getEpisode(c.req.param("id"), getUserId(c));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json().catch(() => null);
    const segments = body?.segments;
    if (!Array.isArray(segments) || !segments.every((s: ScriptSegment) =>
      (s.speaker === "host" || s.speaker === "guest") && typeof s.text === "string")) {
      return c.json({ error: "invalid_script" }, 400);
    }
    const latest = await repo.getLatestScript(c.req.param("id"));
    const version = (latest?.version ?? 0) + 1;
    const saved = await repo.saveScript(c.req.param("id"), version, segments);
    return c.json(saved);
  });
  app.post("/episodes/:id/publish", async (c) => {
    const userId = getUserId(c);
    const ep = await repo.getEpisode(c.req.param("id"), userId);
    if (!ep) return c.json({ error: "not_found" }, 404);
    // 频道门禁：未开通频道（授权码激活）不能发布
    const activated = await repo.getChannelActivatedAt(userId);
    if (!activated) return c.json({ error: "channel_not_active", detail: "请先用授权码开通频道" }, 403);
    await repo.setPublished(c.req.param("id"));
    return c.json({ ok: true }); // 邀请码发放接入点：plan 7
  });
  return app;
}
