// 我的节目端点（/me/episodes）：
//  GET   /v1/me/episodes       → 当前用户的全部节目（含已下架），发布时间倒序
//  PATCH /v1/me/episodes/:id   { isPublic: boolean } → 切换公开状态（下架/重新上架，
//        仅归属人可操作；更新行数 0 → 404）。下架后从首页/RSS/公开接口消失，仅自己可见。
import { Hono } from "hono";
import type { Repos } from "../repo";

export function meEpisodesRoutes(repo: Repos) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.get("/v1/me/episodes", async (c) => {
    const userId = c.get("userId") as string;
    return c.json(await repo.episodes.listByUser(userId));
  });

  app.patch("/v1/me/episodes/:id", async (c) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.isPublic !== "boolean") {
      return c.json({ error: "invalid_input" }, 400);
    }
    const updated = await repo.episodes.setPublic(id, userId, body.isPublic);
    if (updated === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, isPublic: body.isPublic });
  });

  return app;
}
