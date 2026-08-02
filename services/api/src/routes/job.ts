import { Hono } from "hono";

export interface JobDeps {
  getLatestJob(episodeId: string): Promise<{ id: string; status: string; progress: number; error: string | null } | null>;
}

export function jobRoutes(deps: JobDeps) {
  const app = new Hono();
  // 路径自带 /api 前缀（与 job.test.ts 直接对裸 app 请求 /api/... 一致），
  // 挂载时用 app.route("/", jobRoutes(...))，避免前缀重复；/api/* 鉴权中间件依然覆盖
  app.get("/api/episodes/:id/job", async (c) => {
    const job = await deps.getLatestJob(c.req.param("id"));
    if (!job) return c.json({ error: "not_found" }, 404);
    return c.json(job);
  });
  return app;
}
