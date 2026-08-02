import { Hono } from "hono";
import type { VoiceSampleRow } from "./voice";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

export interface EpisodesRepo {
  listEpisodes(userId: string): Promise<Array<{ id: string; title: string | null; status: string; createdAt: Date }>>;
  /** userId 传入时强制归属过滤（防 IDOR） */
  getEpisode(id: string, userId?: string): Promise<{ id: string; userId: string; title: string | null; status: string } | null>;
  saveScript(episodeId: string, version: number, segments: ScriptSegment[]): Promise<{ episodeId: string; version: number; segments: ScriptSegment[] }>;
  getLatestScript(episodeId: string): Promise<{ version: number; segments: ScriptSegment[] } | null>;
  /** 通过 episodes.import_id 读取来源导入的 parsed_dialogue 消息；userId 强制归属过滤（防 IDOR） */
  getImportedDialogue(episodeId: string, userId: string): Promise<{ role: string; content: string }[] | null>;
  setPublished(id: string): Promise<void>;
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
}

export function episodesRoutes(repo: EpisodesRepo, getUserId: (c: unknown) => string) {
  const app = new Hono();
  app.get("/episodes", async (c) => {
    const episodes = await repo.listEpisodes(getUserId(c));
    return c.json(episodes);
  });
  app.get("/episodes/:id", async (c) => {
    const ep = await repo.getEpisode(c.req.param("id"), getUserId(c));
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(ep);
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
    const ep = await repo.getEpisode(c.req.param("id"), getUserId(c));
    if (!ep) return c.json({ error: "not_found" }, 404);
    await repo.setPublished(c.req.param("id"));
    return c.json({ ok: true }); // 邀请码发放接入点：plan 7
  });
  return app;
}
