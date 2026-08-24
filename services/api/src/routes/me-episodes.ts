// 我的节目端点（/me/episodes）：
//  GET   /v1/me/episodes                       → 当前用户的全部节目（含已下架 isPublic=false），发布时间倒序
//  POST  /v1/me/episodes/:id/unpublish-request { reason? } → 申请下线（编辑审批后由编辑侧下架）。
// 内容策展权在平台：节目信息（封面/标题/简介）与公开状态均由编辑端维护，用户无修改/下架权。
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

  // 申请下线：仅公开节目可申请；已有 pending 申请 → 409
  const r2 = createRoute({
    method: "post",
    path: "/v1/me/episodes/:id/unpublish-request",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      201: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/episodes/:id/unpublish-request" },
      400: { content: { "application/json": { schema: Err } }, description: "参数非法" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在或非本人" },
      409: { content: { "application/json": { schema: Err } }, description: "已下架/已有待处理申请" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const id = c.req.param("id")!;
    const owner = await repo.episodes.getRemovalTarget(id);
    if (!owner || owner.userId !== userId) return c.json({ error: "not_found" }, 404);
    if (!owner.isPublic) {
      return c.json({ error: "already_unlisted", detail: "该节目已不在公开列表" }, 409);
    }
    const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const created = await repo.episodes.createRemovalRequest(id, userId, reason || null);
    if (!created) {
      return c.json({ error: "request_pending", detail: "已有待处理的下线申请" }, 409);
    }
    return c.json({ ok: true, requestId: created.id, status: "pending" }, 201);
  }) as unknown as RouteHandler<typeof r2, { Variables: { userId: string } }>);

  return app;
}
