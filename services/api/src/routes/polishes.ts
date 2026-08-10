// 创作容器：POST /api/polishes/new { snapshotId, title? }
// 用户 × 快照唯一（重复创建 → 409 返回已有容器，前端跳编辑页）。
// 频道校验：未开通不能创建容器（与生成/发布同一门槛）。

import { Hono } from "hono";

export interface PolishesDeps {
  getChannelActivatedAt(userId: string): Promise<Date | null>;
  findPolishByUserSnapshot(userId: string, snapshotId: string): Promise<{ id: string; title: string | null } | null>;
  createPolish(row: { userId: string; snapshotId: string; title: string | null }): Promise<{ id: string }>;
  /** 列表（工作台"脚本"页） */
  listByUser(userId: string): Promise<{
    id: string;
    title: string | null;
    status: string;
    snapshotTitle: string | null;
    episodeId: string | null;
    episodeStatus: string | null;
    createdAt: Date;
  }[]>;
  /** 编辑页详情：polish + 快照 meta（标题/质量）+ transcripts 列表 */
  getPolishDetail(id: string, userId: string): Promise<{
    id: string;
    title: string | null;
    snapshotTitle: string | null;
    snapshotUrl: string | null;
    quality: { pass: boolean; reason?: string; language?: string } | null;
    transcripts: { id: string; segments: unknown[]; language: string | null; createdAt: Date }[];
  } | null>;
}

export function polishesRoutes(deps: PolishesDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.post("/v1/polishes/new", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { snapshotId?: unknown; title?: unknown } | null;
    if (!body || typeof body.snapshotId !== "string") {
      return c.json({ error: "invalid_snapshot" }, 400);
    }
    // 频道开通校验（未开通 → 403，前端引导先去创建频道）
    const activated = await deps.getChannelActivatedAt(userId);
    if (!activated) return c.json({ error: "channel_not_activated" }, 403);

    // 用户 × 快照唯一：已存在 → 返回已有容器（前端跳编辑页）
    const existing = await deps.findPolishByUserSnapshot(userId, body.snapshotId);
    if (existing) return c.json({ existing: true, polishId: existing.id }, 409);

    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 200) : null;
    const created = await deps.createPolish({ userId, snapshotId: body.snapshotId, title });
    if (!created.id) return c.json({ existing: true, polishId: "" }, 409); // 并发竞态
    return c.json({ polishId: created.id });
  });

  /** polish 列表（工作台"脚本"页）：标题 + 快照 + 最新节目状态 */
  app.get("/v1/polishes", async (c) => {
    const userId = c.get("userId") as string;
    const list = await deps.listByUser(userId);
    return c.json(list);
  });

  /** 编辑页详情：polish + 快照 meta + transcripts 列表 */
  app.get("/v1/polishes/:id", async (c) => {
    const userId = c.get("userId") as string;
    const detail = await deps.getPolishDetail(c.req.param("id"), userId);
    if (!detail) return c.json({ error: "not_found" }, 404);
    return c.json(detail);
  });

  return app;
}
