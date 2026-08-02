import { Hono } from "hono";
import { isCollectedDialogue, type CollectedDialogue } from "../dialogue";

export interface ImportsRepo {
  findImportBySource(userId: string, platform: string, conversationId: string): Promise<{ id: string } | null>;
  insertImport(row: {
    userId: string; platform: string; sourceTitle: string; sourceConversationId: string;
    sourceUrl: string; parsedDialogue: CollectedDialogue;
  }): Promise<{ id: string }>;
  insertEpisode(row: { userId: string; title: string; status: "draft"; language: string | null; }): Promise<{ id: string }>;
}

export function importsRoutes(repo: ImportsRepo) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.post("/imports", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isCollectedDialogue(body)) return c.json({ error: "invalid_dialogue" }, 400);
    const userId = c.get("userId") as string;
    const existing = await repo.findImportBySource(userId, body.platform, body.conversationId);
    if (existing) return c.json({ error: "already_imported", importId: existing.id }, 409);
    const imp = await repo.insertImport({
      userId, platform: body.platform, sourceTitle: body.title,
      sourceConversationId: body.conversationId, sourceUrl: body.url, parsedDialogue: body,
    });
    const ep = await repo.insertEpisode({ userId, title: body.title, status: "draft", language: null });
    return c.json({ importId: imp.id, episodeId: ep.id }, 201);
  });
  return app;
}
