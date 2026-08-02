import { Hono } from "hono";
import { isCollectedDialogue, type CollectedDialogue, type Platform } from "../dialogue";

export interface ImportRow {
  userId: string;
  platform: Platform;
  sourceTitle: string;
  sourceConversationId: string;
  sourceUrl: string;
  parsedDialogue: CollectedDialogue;
}

export interface EpisodeRow {
  userId: string;
  title: string;
  status: "draft";
  language: string | null;
}

export interface ImportsRepo {
  findImportBySource(userId: string, platform: Platform, conversationId: string): Promise<{ id: string } | null>;
  /** 唯一约束冲突（并发竞态）surface 为 { duplicate: true } */
  insertImport(row: ImportRow): Promise<{ id: string } | { duplicate: true }>;
  insertEpisode(row: EpisodeRow): Promise<{ id: string }>;
  /** insertImport + insertEpisode 同事务写入，避免部分失败孤儿行 */
  createImport(importRow: ImportRow, episodeRow: EpisodeRow): Promise<{ importId: string; episodeId: string } | { duplicate: true }>;
}

export function importsRoutes(repo: ImportsRepo) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.post("/imports", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isCollectedDialogue(body)) return c.json({ error: "invalid_dialogue" }, 400);
    const userId = c.get("userId") as string;
    // 快速路径预检查；竞态安全依赖 createImport 内唯一约束信号（23505 → duplicate）
    const existing = await repo.findImportBySource(userId, body.platform, body.conversationId);
    if (existing) return c.json({ error: "already_imported", importId: existing.id }, 409);
    const result = await repo.createImport(
      {
        userId, platform: body.platform, sourceTitle: body.title,
        sourceConversationId: body.conversationId, sourceUrl: body.url, parsedDialogue: body,
      },
      { userId, title: body.title, status: "draft", language: null },
    );
    if ("duplicate" in result) return c.json({ error: "already_imported" }, 409);
    return c.json({ importId: result.importId, episodeId: result.episodeId }, 201);
  });
  return app;
}
