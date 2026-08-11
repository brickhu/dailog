// 投稿端点（投稿制，PRD §4.1/§4.5）：
//  POST /api/v1/submissions  { snapshotId, title? } → 创建 submitted 容器（已存在 → existing）
//  GET  /api/v1/me/submissions → 我的投稿及状态（submitted/accepted/rejected + 最新节目状态）
// 状态机承载在 polishes（容器）：投稿提交时尚无脚本，episodes 仅生成后才存在（transcriptId NOT NULL）

import { Hono } from "hono";
import type { Repos } from "../repo";

export function submissionsRoutes(repo: Repos) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.post("/v1/submissions", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { snapshotId?: unknown; title?: unknown } | null;
    if (!body || typeof body.snapshotId !== "string" || !body.snapshotId.trim()) {
      return c.json({ error: "invalid_snapshot", detail: "缺少 snapshotId（请先导入分享链接）" }, 400);
    }
    const snapshot = await repo.snapshots.getById(body.snapshotId);
    if (!snapshot) return c.json({ error: "not_found", detail: "快照不存在（请先导入分享链接）" }, 404);
    // 重复提交同一对话 → 返回已有容器（前端提示继续或去查看状态）
    const existing = await repo.polishes.findByUserSnapshot(userId, body.snapshotId);
    if (existing) {
      return c.json({ existing: true, submissionId: existing.id, status: existing.status });
    }
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : snapshot.sourceTitle;
    const created = await repo.polishes.createSubmission(userId, body.snapshotId, title);
    if (!created.id) {
      return c.json({ error: "already_submitted", detail: "该对话已提交过投稿" }, 409);
    }
    return c.json({ submissionId: created.id, status: "submitted" }, 201);
  });

  app.get("/v1/me/submissions", async (c) => {
    const userId = c.get("userId") as string;
    const list = await repo.polishes.listSubmissionsByUser(userId);
    return c.json(list);
  });

  return app;
}
