import { Hono } from "hono";
import type { CollectedDialogue } from "../dialogue"; // 仅类型参考，脚本段类型独立定义

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

export interface EpisodesRepo {
  listEpisodes(userId: string): Promise<Array<{ id: string; title: string | null; status: string; createdAt: Date }>>;
  getEpisode(id: string): Promise<{ id: string; userId: string; title: string | null; status: string } | null>;
  saveScript(episodeId: string, version: number, segments: ScriptSegment[]): Promise<{ episodeId: string; version: number; segments: ScriptSegment[] }>;
  getLatestScript(episodeId: string): Promise<{ version: number; segments: ScriptSegment[] } | null>;
  setPublished(id: string): Promise<void>;
}

export function episodesRoutes(repo: EpisodesRepo, getUserId: (c: unknown) => string) {
  const app = new Hono();
  app.get("/episodes", async (c) => {
    const episodes = await repo.listEpisodes(getUserId(c));
    return c.json(episodes);
  });
  app.get("/episodes/:id", async (c) => {
    const ep = await repo.getEpisode(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(ep);
  });
  app.put("/episodes/:id/script", async (c) => {
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
    const ep = await repo.getEpisode(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    await repo.setPublished(c.req.param("id"));
    return c.json({ ok: true }); // 邀请码发放接入点：plan 7
  });
  return app;
}
