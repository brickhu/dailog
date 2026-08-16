// 我的节目端点（/me/episodes）：
//  GET   /v1/me/episodes       → 当前用户的全部节目（含已下架），发布时间倒序
//  PATCH /v1/me/episodes/:id   { isPublic: boolean } → 切换公开状态（下架/重新上架，
//        仅归属人可操作；更新行数 0 → 404）。下架后从首页/RSS/公开接口消失，仅自己可见。
import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Repos } from "../repo";

export function meEpisodesRoutes(repo: Repos) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  const r1 = createRoute({
    method: "get",
    path: "/v1/me/episodes",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/episodes" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    const userId = c.get("userId") as string;
    return c.json(await repo.episodes.listByUser(userId));
  }) as unknown as RouteHandler<typeof r1, { Variables: { userId: string } }>);

  const r2 = createRoute({
    method: "patch",
    path: "/v1/me/episodes/:id",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/episodes/:id" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id")!;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.isPublic !== "boolean") {
      return c.json({ error: "invalid_input" }, 400);
    }
    const updated = await repo.episodes.setPublic(id, userId, body.isPublic);
    if (updated === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, isPublic: body.isPublic });
  }) as unknown as RouteHandler<typeof r2, { Variables: { userId: string } }>);

  return app;
}
