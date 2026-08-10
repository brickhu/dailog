import { Hono } from "hono";
import type { VoiceSampleRow } from "./voice";
import { canGenerate } from "../quota";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

export interface EpisodesDeps {
  // ---- 列表/详情/音频 ----
  listByUser(userId: string): Promise<Array<{ id: string; title: string | null; status: string; polishId: string; durationSeconds: number | null; topic: string | null; tags: string[] | null; coverUrl: string | null; createdAt: Date }>>;
  /** 详情（/episodes/:id 页） */
  getOwned(id: string, userId: string): Promise<{
    id: string;
    transcriptId: string;
    polishId: string;
    title: string | null;
    description: string | null;
    status: string;
    durationSeconds: number | null;
    topic: string | null;
    tags: string[] | null;
    coverUrl: string | null;
    createdAt: Date;
    publishedAt: Date | null;
  } | null>;
  getEpisodeAudio(id: string, userId: string): Promise<string | null>;
  // ---- 创建（由 transcript 生成） ----
  getOwnedTranscript(transcriptId: string, userId: string): Promise<{
    id: string;
    polishId: string;
    segments: ScriptSegment[];
    topic: string | null;
    language: string | null;
    guestId: string | null;
    snapshotId: string | null;
  } | null>;
  /** 一个脚本只能生成一期节目：查该脚本是否已生成过（唯一约束兜底，主动检查给友好错误） */
  getEpisodeByTranscript(transcriptId: string): Promise<{ id: string } | null>;
  createEpisode(row: {
    userId: string;
    transcriptId: string;
    polishId: string;
    title: string | null;
    description?: string | null;
    snapshotId?: string | null;
    topic?: string | null;
    tags?: string[] | null;
    subtitle?: string | null;
    hostId?: string | null;
    guestId?: string | null;
  }): Promise<{ id: string }>;
  /** 标记脚本已生成节目（一脚本一期） */
  markUsed(transcriptId: string): Promise<void>;
  // ---- 生成 ----
  safetyCheck(segments: ScriptSegment[]): Promise<{ pass: boolean; reason?: string; title?: string; description?: string; tags?: string[]; topic?: string }>;
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
  /** 按语种取采样（生成缺语种提醒用）；无该语种 → null（管线用兜底） */
  getVoiceSampleByLanguage(userId: string, language: string): Promise<VoiceSampleRow | null>;
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
}

/** 字幕程序化生成：脚本去情绪/停顿标签（[break]/[happy] 等）后的纯文本 */
export function subtitleFromSegments(segments: ScriptSegment[]): string {
  return segments
    .map((s) => s.text.replace(/\[[a-zA-Z-]+\]/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
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
    // 同时输出节目元数据（title/description/tags/topic）——用户手动传的 title/description 优先
    const safety = await deps.safetyCheck(transcript.segments);
    if (!safety.pass) return c.json({ error: "safety_rejected", reason: safety.reason }, 422);
    // 频道门禁：未开通频道（授权码激活）不能生成
    const channelActive = await deps.getChannelActive(userId);
    if (!channelActive) return c.json({ error: "channel_not_active", detail: "请先用授权码开通频道" }, 403);
    const quota = await deps.getQuota(userId);
    const decision = canGenerate(quota);
    if (!decision.ok) return c.json({ error: "quota_exceeded", reason: decision.reason }, 403);
    await deps.consumeQuota(userId, decision.consumeCredit);
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : safety.title ?? null;
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim().slice(0, 2000) : safety.description ?? null;
    const tags = Array.isArray(safety.tags)
      ? safety.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8)
      : null;
    const episode = await deps.createEpisode({
      userId,
      transcriptId: transcript.id,
      polishId: transcript.polishId,
      title,
      description,
      topic: transcript.topic,
      tags,
      subtitle: subtitleFromSegments(transcript.segments),
      snapshotId: transcript.snapshotId,
      hostId: userId,
      guestId: transcript.guestId,
    });
    // 一脚本一期：标记脚本已生成节目
    await deps.markUsed(transcript.id);
    // 缺该语种采样 → 生成管线用兜底样本，提醒前端（不强求）
    let warning: string | undefined;
    if (transcript.language) {
      const sample = await deps.getVoiceSampleByLanguage(userId, transcript.language);
      if (!sample) warning = "missing_voice_language";
    }
    const job = await deps.createJob(episode.id);
    await deps.enqueueJob({ id: job.id, episodeId: job.episodeId });
    return c.json({ episodeId: episode.id, jobId: job.id, status: job.status, ...(warning ? { warning } : {}) }, 202);
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
