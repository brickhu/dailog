// 站内通知端点（投稿状态变化：收录/拒绝/上线）
//  GET  /v1/me/notifications          → 我的通知（新→旧）
//  GET  /v1/me/notifications/unread   → 未读数
//  POST /v1/me/notifications/read-all → 全部标记已读

import { Hono } from "hono";
import type { Repos } from "../repo";

export function notificationsRoutes(repo: Repos) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.get("/v1/me/notifications", async (c) => {
    const userId = c.get("userId") as string;
    const list = await repo.notifications.listByUser(userId);
    return c.json(list);
  });

  app.get("/v1/me/notifications/unread", async (c) => {
    const userId = c.get("userId") as string;
    const count = await repo.notifications.unreadCount(userId);
    return c.json({ count });
  });

  app.post("/v1/me/notifications/read-all", async (c) => {
    const userId = c.get("userId") as string;
    await repo.notifications.markAllRead(userId);
    return c.json({ ok: true });
  });

  return app;
}
