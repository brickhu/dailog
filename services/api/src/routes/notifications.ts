// 站内通知端点（投稿状态变化：收录/拒绝/上线）
//  GET  /v1/me/notifications          → 我的通知（新→旧）
//  GET  /v1/me/notifications/unread   → 未读数
//  POST /v1/me/notifications/read-all → 全部标记已读

import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Repos } from "../repo";

export function notificationsRoutes(repo: Repos) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  const r1 = createRoute({
    method: "get",
    path: "/v1/me/notifications",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/notifications" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const list = await repo.notifications.listByUser(userId);
    return c.json(list);
  }) as unknown as RouteHandler<typeof r1, { Variables: { userId: string } }>);

  const r2 = createRoute({
    method: "get",
    path: "/v1/me/notifications/unread",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/notifications/unread" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const count = await repo.notifications.unreadCount(userId);
    return c.json({ count });
  }) as unknown as RouteHandler<typeof r2, { Variables: { userId: string } }>);

  const r3 = createRoute({
    method: "post",
    path: "/v1/me/notifications/read-all",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/notifications/read-all" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r3, (async (c: Context) => {
    const userId = c.get("userId") as string;
    await repo.notifications.markAllRead(userId);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof r3, { Variables: { userId: string } }>);

  return app;
}
