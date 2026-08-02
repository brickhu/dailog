import { Hono } from "hono";

export interface JobDeps {
  /** 归属校验（防 IDOR）：返回 null 视为不存在或不属于该用户 */
  getOwnedEpisode(episodeId: string, userId: string): Promise<{ id: string } | null>;
  getLatestJob(episodeId: string): Promise<{ id: string; status: string; progress: number; error: string | null } | null>;
}

export function jobRoutes(deps: JobDeps, getUserId: (c: unknown) => string) {
  const app = new Hono();
  // 路径自带 /api 前缀（与 job.test.ts 直接对裸 app 请求 /api/... 一致），
  // 挂载时用 app.route("/", jobRoutes(...))，避免前缀重复；/api/* 鉴权中间件依然覆盖
  app.get("/api/episodes/:id/job", async (c) => {
    const episodeId = c.req.param("id");
    const owned = await deps.getOwnedEpisode(episodeId, getUserId(c));
    if (!owned) return c.json({ error: "not_found" }, 404);
    const job = await deps.getLatestJob(episodeId);
    if (!job) return c.json({ error: "not_found" }, 404);
    return c.json(job);
  });
  return app;
}
