import { Hono } from "hono";
import type { ScriptSegment } from "./episodes";
import { canGenerate } from "../quota";

export interface GenerateDeps {
  getLatestScript(episodeId: string): Promise<{ version: number; segments: ScriptSegment[] } | null>;
  safetyCheck(segments: ScriptSegment[]): Promise<{ pass: boolean; reason?: string }>;
  getQuota(userId: string): Promise<{ plan: "free" | "pro"; generatedCount: number; creditBalance: number }>;
  consumeQuota(userId: string, consumeCredit: number): Promise<void>;
  createJob(episodeId: string): Promise<{ id: string; episodeId: string; status: string; progress: number }>;
  enqueueJob(jobId: string): Promise<void>;
}

export function generateRoutes(deps: GenerateDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  // 注意：路径自带 /api 前缀（与 generate.test.ts 直接对裸 app 请求 /api/... 一致），
  // 挂载时用 app.route("/", generateRoutes(...))，避免前缀重复；/api/* 鉴权中间件依然覆盖
  app.post("/api/episodes/:id/generate", async (c) => {
    const episodeId = c.req.param("id");
    const userId = c.get("userId") as string;
    const script = await deps.getLatestScript(episodeId);
    if (!script) return c.json({ error: "no_script" }, 404);
    // 生成前内容安全审核（编辑后脚本）：拒绝不建 job 不扣配额（PRD §4.4）
    const safety = await deps.safetyCheck(script.segments);
    if (!safety.pass) return c.json({ error: "safety_rejected", reason: safety.reason }, 422);
    const quota = await deps.getQuota(userId);
    const decision = canGenerate(quota);
    if (!decision.ok) return c.json({ error: "quota_exceeded", reason: decision.reason }, 403);
    await deps.consumeQuota(userId, decision.consumeCredit);
    const job = await deps.createJob(episodeId);
    await deps.enqueueJob(job.id);
    return c.json({ jobId: job.id, status: job.status }, 202);
  });
  return app;
}
