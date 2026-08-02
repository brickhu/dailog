import { and, count, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema";
import type { EpisodesRepo, ScriptSegment } from "../routes/episodes";
import type { EpisodeRow, ImportRow, ImportsRepo } from "../routes/imports";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

function randomSlug(): string {
  return randomBytes(8).toString("hex");
}

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
}

export type Repos = { imports: ImportsRepo; episodes: EpisodesRepo; jobs: JobsRepo };

export function createRepo(db: PostgresJsDatabase<typeof schema>): Repos {
  return {
    imports: {
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
          const rows = await db.insert(schema.imports).values({
            userId: row.userId,
            platform: row.platform,
            sourceTitle: row.sourceTitle,
            sourceConversationId: row.sourceConversationId,
            sourceUrl: row.sourceUrl,
            parsedDialogue: row.parsedDialogue,
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
              userId: importRow.userId,
              platform: importRow.platform,
              sourceTitle: importRow.sourceTitle,
              sourceConversationId: importRow.sourceConversationId,
              sourceUrl: importRow.sourceUrl,
              parsedDialogue: importRow.parsedDialogue,
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
            createdAt: schema.episodes.createdAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.userId, userId))
          .orderBy(desc(schema.episodes.createdAt));
      },

      async getEpisode(id) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            userId: schema.episodes.userId,
            title: schema.episodes.title,
            status: schema.episodes.status,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, id))
          .limit(1);
        return rows[0] ?? null;
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
        const rows = await db
          .select({ parsedDialogue: schema.imports.parsedDialogue })
          .from(schema.episodes)
          .innerJoin(schema.imports, eq(schema.episodes.importId, schema.imports.id))
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.userId, userId)))
          .limit(1);
        const row = rows[0];
        if (!row?.parsedDialogue) return null;
        const dialogue = row.parsedDialogue as { messages?: { role: string; content: string }[] };
        return dialogue.messages ?? null;
      },

      async setPublished(id) {
        await db.update(schema.episodes)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(schema.episodes.id, id));
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
    },
  };
}
