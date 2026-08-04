import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema";
import type { EpisodesRepo, ScriptSegment } from "../routes/episodes";
import type { EpisodeRow, ImportRow, ImportsRepo } from "../routes/imports";
import type { VoiceSampleRow } from "../routes/voice";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

function randomSlug(): string {
  return randomBytes(8).toString("hex");
}

export type JobStatus = "queued" | "tts" | "merge" | "upload" | "done" | "failed";

export interface JobsRepo {
  /** 用户配额：plan + credit_balance + 已完成生成（status=done 的 job，经 episodes.user_id 归属）的期数 */
  getQuotaInfo(userId: string): Promise<{ plan: "free" | "pro"; generatedCount: number; creditBalance: number }>;
  /** 扣积分：仅 free 用户扣 credit_balance；pro 不扣 */
  consumeQuota(userId: string, credit: number): Promise<void>;
  /** 建生成 job（queued），返回 job 行 */
  createJob(episodeId: string): Promise<{ id: string; episodeId: string; status: string; progress: number }>;
  /** 最新 job（created_at desc） */
  getLatestJob(episodeId: string): Promise<{ id: string; status: string; progress: number; error: string | null } | null>;
  /** 归属校验（防 IDOR）：返回 null 视为不存在或不属于该用户 */
  getOwnedEpisode(episodeId: string, userId: string): Promise<{ id: string } | null>;
  /** 未完成 job（queued/tts/merge/upload）：启动恢复重新入队 */
  listRecoverableJobs(): Promise<{ id: string; episodeId: string }[]>;
  /** 推进 job 状态/进度（queued→tts→merge→upload） */
  markJobProgress(jobId: string, status: JobStatus, progress: number): Promise<void>;
  /** job 完成：status=done、progress=100 */
  markJobDone(jobId: string): Promise<void>;
  /** 生成产物落库：episodes.audio_url + duration_seconds */
  updateEpisodeAudio(episodeId: string, audioKey: string, durationSeconds: number): Promise<void>;
  /** 队列重试耗尽后落库失败状态（防重启恢复重跑） */
  markJobFailed(jobId: string, error: string): Promise<void>;
}

export type Repos = { imports: ImportsRepo; episodes: EpisodesRepo; jobs: JobsRepo };

export function createRepo(db: PostgresJsDatabase<typeof schema>): Repos {
  return {
    imports: {
      async getChannelActivatedAt(userId) {
        const rows = await db
          .select({ channelActivatedAt: schema.profiles.channelActivatedAt })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        return rows[0]?.channelActivatedAt ?? null;
      },
      async findImportBySource(userId, platform, conversationId) {
        const rows = await db
          .select({ id: schema.imports.id })
          .from(schema.imports)
          .where(and(
            eq(schema.imports.userId, userId),
            eq(schema.imports.platform, platform),
            eq(schema.imports.sourceConversationId, conversationId),
          ))
          .limit(1);
        return rows[0] ?? null;
      },

      async insertImport(row: ImportRow) {
        try {
          // id 由路由层预生成（R2 对象 key 依赖 importId，先 put 后插库）
          const rows = await db.insert(schema.imports).values({
            id: row.id,
            userId: row.userId,
            platform: row.platform,
            sourceTitle: row.sourceTitle,
            sourceConversationId: row.sourceConversationId,
            sourceUrl: row.sourceUrl,
          }).returning({ id: schema.imports.id });
          return { id: rows[0].id };
        } catch (err) {
          if (isUniqueViolation(err)) return { duplicate: true };
          throw err;
        }
      },

      async insertEpisode(row: EpisodeRow) {
        const rows = await db.insert(schema.episodes).values({
          userId: row.userId,
          slug: randomSlug(),
          title: row.title,
          status: row.status,
          language: row.language,
        }).returning({ id: schema.episodes.id });
        return { id: rows[0].id };
      },

      async createImport(importRow: ImportRow, episodeRow: EpisodeRow) {
        try {
          // 事务内先后写入；任何一步失败整体回滚，不产生孤儿行
          return await db.transaction(async (tx) => {
            const imp = await tx.insert(schema.imports).values({
              id: importRow.id,
              userId: importRow.userId,
              platform: importRow.platform,
              sourceTitle: importRow.sourceTitle,
              sourceConversationId: importRow.sourceConversationId,
              sourceUrl: importRow.sourceUrl,
            }).returning({ id: schema.imports.id });
            const ep = await tx.insert(schema.episodes).values({
              userId: episodeRow.userId,
              slug: randomSlug(),
              title: episodeRow.title,
              status: episodeRow.status,
              language: episodeRow.language,
              importId: imp[0].id,
            }).returning({ id: schema.episodes.id });
            return { importId: imp[0].id, episodeId: ep[0].id };
          });
        } catch (err) {
          // 竞态：预检查通过后并发插入撞唯一索引 imports_user_platform_conv
          if (isUniqueViolation(err)) return { duplicate: true };
          throw err;
        }
      },
    },

    episodes: {
      async listEpisodes(userId) {
        return db
          .select({
            id: schema.episodes.id,
            title: schema.episodes.title,
            status: schema.episodes.status,
            platform: schema.imports.platform,
            createdAt: schema.episodes.createdAt,
          })
          .from(schema.episodes)
          .leftJoin(schema.imports, eq(schema.episodes.importId, schema.imports.id))
          .where(eq(schema.episodes.userId, userId))
          .orderBy(desc(schema.episodes.createdAt));
      },

      async getEpisode(id, userId?) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            userId: schema.episodes.userId,
            title: schema.episodes.title,
            status: schema.episodes.status,
          })
          .from(schema.episodes)
          .where(userId ? and(eq(schema.episodes.id, id), eq(schema.episodes.userId, userId)) : eq(schema.episodes.id, id))
          .limit(1);
        return rows[0] ?? null;
      },

      async getEpisodeAudio(id, userId) {
        const rows = await db
          .select({ audioUrl: schema.episodes.audioUrl })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.id, id), eq(schema.episodes.userId, userId)))
          .limit(1);
        return rows[0]?.audioUrl ?? null;
      },

      async saveScript(episodeId, version, segments) {
        await db.insert(schema.scripts).values({ episodeId, version, segments });
        return { episodeId, version, segments };
      },

      async getLatestScript(episodeId) {
        const rows = await db
          .select({
            version: schema.scripts.version,
            segments: schema.scripts.segments,
          })
          .from(schema.scripts)
          .where(eq(schema.scripts.episodeId, episodeId))
          .orderBy(desc(schema.scripts.version))
          .limit(1);
        const row = rows[0];
        return row ? { version: row.version, segments: row.segments as ScriptSegment[] } : null;
      },

      async getImportedDialogue(episodeId, userId) {
        // 对话内容在 R2（imports/{id}.dialogue.json）——只回 importId，由调用方经 storage 读取
        const rows = await db
          .select({ importId: schema.imports.id })
          .from(schema.episodes)
          .innerJoin(schema.imports, eq(schema.episodes.importId, schema.imports.id))
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.userId, userId)))
          .limit(1);
        const row = rows[0];
        return row ? { importId: row.importId } : null;
      },

      async getPublishedDialogue(episodeId) {
        // 对话内容在 R2——回 importId + meta，由调用方读 storage
        const rows = await db
          .select({
            importId: schema.imports.id,
            platform: schema.imports.platform,
            sourceTitle: schema.imports.sourceTitle,
            sourceUrl: schema.imports.sourceUrl,
          })
          .from(schema.episodes)
          .innerJoin(schema.imports, eq(schema.episodes.importId, schema.imports.id))
          // 公开只读语义：仅已发布节目可读，草稿一律不可见
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.isPublic, true)))
          .limit(1);
        const row = rows[0];
        return row
          ? { importId: row.importId, platform: row.platform, sourceTitle: row.sourceTitle ?? null, sourceUrl: row.sourceUrl }
          : null;
      },

      async setEpisodeLanguage(id, language) {
        await db.update(schema.episodes).set({ language }).where(eq(schema.episodes.id, id));
      },

      async getPolishCount(episodeId) {
        const rows = await db
          .select({ polishCount: schema.episodes.polishCount })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.polishCount ?? 0;
      },

      async incrementPolishCount(episodeId) {
        await db
          .update(schema.episodes)
          .set({ polishCount: sql`${schema.episodes.polishCount} + 1` })
          .where(eq(schema.episodes.id, episodeId));
      },

      async setPublished(id) {
        // 发布即公开（MVP 无私密选项；PRD §4.6 私密为后续扩展），
        // is_public 是内容站/公开只读接口（getPublishedDialogue）的可见性开关
        await db.update(schema.episodes)
          .set({ status: "published", isPublic: true, publishedAt: new Date() })
          .where(eq(schema.episodes.id, id));
      },

      async getEpisodeUserId(episodeId) {
        const rows = await db
          .select({ userId: schema.episodes.userId })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.userId ?? null;
      },

      async getEpisodeLanguage(episodeId) {
        const rows = await db
          .select({ language: schema.episodes.language })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.language ?? null;
      },

      async getHostModelId(userId) {
        const rows = await db
          .select({ referenceId: schema.voiceSamples.referenceId })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.status, "ready")))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return rows[0]?.referenceId ?? null;
      },

      async getVoiceSampleKey(userId) {
        const rows = await db
          .select({ audioUrl: schema.voiceSamples.audioUrl })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.status, "ready")))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return rows[0]?.audioUrl ?? null;
      },

      /** 工作台回读：用户最新一条样本（不限 status，前端区分 ready/failed） */
      async getVoiceSample(userId) {
        const rows = await db
          .select({
            userId: schema.voiceSamples.userId,
            status: schema.voiceSamples.status,
            referenceId: schema.voiceSamples.referenceId,
            transcript: schema.voiceSamples.transcript,
            audioUrl: schema.voiceSamples.audioUrl,
            duration: schema.voiceSamples.duration,
            createdAt: schema.voiceSamples.createdAt,
          })
          .from(schema.voiceSamples)
          .where(eq(schema.voiceSamples.userId, userId))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },

      async getChannelActivatedAt(userId) {
        const rows = await db
          .select({ channelActivatedAt: schema.profiles.channelActivatedAt })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        return rows[0]?.channelActivatedAt ?? null;
      },

      async saveVoiceSample(row: VoiceSampleRow) {
        // upsert：voice_samples 无 user_id 唯一约束，先删该用户旧行再插，实现「同 user 覆盖」
        await db.transaction(async (tx) => {
          await tx.delete(schema.voiceSamples).where(eq(schema.voiceSamples.userId, row.userId));
          await tx.insert(schema.voiceSamples).values({
            userId: row.userId,
            audioUrl: row.audioUrl,
            referenceId: row.referenceId,
            transcript: row.transcript,
            duration: row.duration,
            status: row.status,
          });
        });
      },
    },

    jobs: {
      async getQuotaInfo(userId) {
        const profileRows = await db
          .select({ plan: schema.profiles.plan, creditBalance: schema.profiles.creditBalance })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        const profile = profileRows[0];
        if (!profile) return { plan: "free", generatedCount: 0, creditBalance: 0 };
        const doneRows = await db
          .select({ count: count() })
          .from(schema.generationJobs)
          .innerJoin(schema.episodes, eq(schema.generationJobs.episodeId, schema.episodes.id))
          .where(and(eq(schema.episodes.userId, userId), eq(schema.generationJobs.status, "done")));
        return {
          plan: profile.plan,
          generatedCount: Number(doneRows[0].count),
          creditBalance: profile.creditBalance,
        };
      },

      async consumeQuota(userId, credit) {
        if (credit <= 0) return; // pro：不扣积分
        await db.update(schema.profiles)
          .set({ creditBalance: sql`${schema.profiles.creditBalance} - ${credit}` })
          .where(and(eq(schema.profiles.id, userId), eq(schema.profiles.plan, "free")));
      },

      async createJob(episodeId) {
        const rows = await db.insert(schema.generationJobs).values({
          episodeId,
          status: "queued",
          progress: 0,
        }).returning({
          id: schema.generationJobs.id,
          episodeId: schema.generationJobs.episodeId,
          status: schema.generationJobs.status,
          progress: schema.generationJobs.progress,
        });
        return rows[0];
      },

      async markJobFailed(jobId, error) {
        await db
          .update(schema.generationJobs)
          .set({ status: "failed", error })
          .where(eq(schema.generationJobs.id, jobId));
      },

      async getOwnedEpisode(episodeId, userId) {
        const rows = await db
          .select({ id: schema.episodes.id })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.userId, userId)))
          .limit(1);
        return rows[0] ?? null;
      },

      async getLatestJob(episodeId) {
        const rows = await db
          .select({
            id: schema.generationJobs.id,
            status: schema.generationJobs.status,
            progress: schema.generationJobs.progress,
            error: schema.generationJobs.error,
          })
          .from(schema.generationJobs)
          .where(eq(schema.generationJobs.episodeId, episodeId))
          .orderBy(desc(schema.generationJobs.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },

      async listRecoverableJobs() {
        return db
          .select({ id: schema.generationJobs.id, episodeId: schema.generationJobs.episodeId })
          .from(schema.generationJobs)
          .where(inArray(schema.generationJobs.status, ["queued", "tts", "merge", "upload"]));
      },

      async markJobProgress(jobId, status, progress) {
        await db.update(schema.generationJobs)
          .set({ status, progress, updatedAt: new Date() })
          .where(eq(schema.generationJobs.id, jobId));
      },

      async markJobDone(jobId) {
        await db.update(schema.generationJobs)
          .set({ status: "done", progress: 100, error: null, updatedAt: new Date() })
          .where(eq(schema.generationJobs.id, jobId));
      },

      async updateEpisodeAudio(episodeId, audioKey, durationSeconds) {
        await db.update(schema.episodes)
          // duration_seconds 是 integer 列：ffmpeg Duration 探测返回浮点秒数，落库前取整
          .set({ audioUrl: audioKey, durationSeconds: Math.round(durationSeconds) })
          .where(eq(schema.episodes.id, episodeId));
      },
    },
  };
}
