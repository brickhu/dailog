import { and, desc, eq } from "drizzle-orm";
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

export type Repos = { imports: ImportsRepo; episodes: EpisodesRepo };

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

      async setPublished(id) {
        await db.update(schema.episodes)
          .set({ status: "published", publishedAt: new Date() })
          .where(eq(schema.episodes.id, id));
      },
    },
  };
}
