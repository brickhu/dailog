import { Hono } from "hono";
import type { VoiceSampleRow } from "./voice";
import { canGenerate } from "../quota";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

export interface EpisodesDeps {
  // ---- 列表/详情/音频 ----
  listByUser(userId: string): Promise<Array<{ id: string; title: string | null; status: string; polishId: string; createdAt: Date }>>;
  getOwned(id: string, userId: string): Promise<{ id: string; transcriptId: string; polishId: string; title: string | null; status: string } | null>;
  getEpisodeAudio(id: string, userId: string): Promise<string | null>;
  // ---- 创建（由 transcript 生成） ----
  getOwnedTranscript(transcriptId: string, userId: string): Promise<{ id: string; polishId: string; segments: ScriptSegment[] } | null>;
  /** 一个脚本只能生成一期节目：查该脚本是否已生成过（唯一约束兜底，主动检查给友好错误） */
  getEpisodeByTranscript(transcriptId: string): Promise<{ id: string } | null>;
  /** 一个脚本只能生成一期节目：查该脚本是否已生成过（唯一约束兜底，主动检查给友好错误） */
  getEpisodeByTranscript(transcriptId: string): Promise<{ id: string } | null>;
  createEpisode(row: { userId: string; transcriptId: string; polishId: string; title: string | null; description?: string | null }): Promise<{ id: string }>;
  // ---- 生成 ----
  safetyCheck(segments: ScriptSegment[]): Promise<{ pass: boolean; reason?: string }>;
  getChannelActive(userId: string): Promise<boolean>;
  getQuota(userId: string): Promise<{ plan: "free" | "pro"; generatedCount: number; creditBalance: number }>;
  consumeQuota(userId: string, consumeCredit: number): Promise<void>;
  createJob(episodeId: string): Promise<{ id: string; episodeId: string; status: string; progress: number }>;
  enqueueJob(job: { id: string; episodeId: string }): Promise<void>;
  // ---- 发布 ----
  setPublished(id: string): Promise<void>;
  getChannelActivatedAt(userId: string): Promise<Date | null>;
  // ---- voice/channel（沿用） ----
  getHostModelId(userId: string): Promise<string | null>;
  getVoiceSampleKey(userId: string): Promise<string | null>;
  getVoiceSample(userId: string): Promise<VoiceSampleRow | null>;
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
}

export function episodesRoutes(
  deps: EpisodesDeps,
  getUserId: (c: unknown) => string,
  storage?: { get(key: string): Promise<Uint8Array> },
) {
  const app = new Hono();

  // 节目列表（工作台）
  app.get("/episodes", async (c) => {
    const episodes = await deps.listByUser(getUserId(c));
    return c.json(episodes);
  });

  // 工作台试听：归属校验后流式返回音频（fs/r2 统一走 storage.get）
  app.get("/episodes/:id/audio", async (c) => {
    const userId = getUserId(c);
    const key = await deps.getEpisodeAudio(c.req.param("id"), userId);
    if (!key || !storage) return c.json({ error: "not_found" }, 404);
    try {
      const data = await storage.get(key);
      return new Response(new Uint8Array(data), { headers: { "Content-Type": "audio/mpeg" } });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  app.get("/episodes/:id", async (c) => {
    const ep = await deps.getOwned(c.req.param("id"), getUserId(c));
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(ep);
  });

  // 创建节目（选定 transcript）：安全审核 → 频道 → 配额 → 建 job 后台执行
  app.post("/episodes/new", async (c) => {
    const userId = getUserId(c);
    const body = (await c.req.json().catch(() => null)) as { transcriptId?: unknown; title?: unknown; description?: unknown } | null;
    if (!body || typeof body.transcriptId !== "string") {
      return c.json({ error: "invalid_transcript" }, 400);
    }
    const transcript = await deps.getOwnedTranscript(body.transcriptId, userId);
    if (!transcript) return c.json({ error: "not_found" }, 404);
    // 一个脚本只能生成一期节目
    const usedBy = await deps.getEpisodeByTranscript(body.transcriptId);
    if (usedBy) return c.json({ error: "script_used", detail: "该脚本已生成过节目", episodeId: usedBy.id }, 409);
    // 生成前内容安全审核（编辑后脚本）：拒绝不建 job 不扣配额（PRD §4.4）
    const safety = await deps.safetyCheck(transcript.segments);
    if (!safety.pass) return c.json({ error: "safety_rejected", reason: safety.reason }, 422);
    // 频道门禁：未开通频道（授权码激活）不能生成
    const channelActive = await deps.getChannelActive(userId);
    if (!channelActive) return c.json({ error: "channel_not_active", detail: "请先用授权码开通频道" }, 403);
    const quota = await deps.getQuota(userId);
    const decision = canGenerate(quota);
    if (!decision.ok) return c.json({ error: "quota_exceeded", reason: decision.reason }, 403);
    await deps.consumeQuota(userId, decision.consumeCredit);
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : null;
    const episode = await deps.createEpisode({
      userId,
      transcriptId: transcript.id,
      polishId: transcript.polishId,
      title,
      description,
    });
    const job = await deps.createJob(episode.id);
    await deps.enqueueJob({ id: job.id, episodeId: job.episodeId });
    return c.json({ episodeId: episode.id, jobId: job.id, status: job.status }, 202);
  });

  app.post("/episodes/:id/publish", async (c) => {
    const userId = getUserId(c);
    const ep = await deps.getOwned(c.req.param("id"), userId);
    if (!ep) return c.json({ error: "not_found" }, 404);
    // 频道门禁：未开通频道（授权码激活）不能发布
    const activated = await deps.getChannelActivatedAt(userId);
    if (!activated) return c.json({ error: "channel_not_active", detail: "请先用授权码开通频道" }, 403);
    await deps.setPublished(c.req.param("id"));
    return c.json({ ok: true }); // 邀请码发放接入点：plan 7
  });

  return app;
}
