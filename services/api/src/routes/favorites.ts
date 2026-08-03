import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// 消费端互动（计划 6）：收藏/点赞 toggle + 我的收藏列表。
// 两站共用：SSR 站（server 转发 cookie）与 SPA 站（Bearer/cookie）都调这些端点。

export interface FavoritesRepo {
  /** episode 存在校验（任意用户视角：published 才可互动） */
  getPublishableEpisode(id: string): Promise<{ id: string; userId: string } | null>;
  toggleFavorite(userId: string, episodeId: string): Promise<{ favorited: boolean }>;
  toggleLike(userId: string, episodeId: string): Promise<{ liked: boolean }>;
  listFavorites(userId: string): Promise<
    Array<{
      episodeId: string;
      title: string | null;
      audioUrl: string | null;
      durationSeconds: number | null;
      publishedAt: Date | null;
      favoritedAt: Date;
    }>
  >;
}

export function favoritesRoutes(repo: FavoritesRepo) {
  const app = new Hono<{ Variables: { userId: string } }>();
  // 路径自带 /api 前缀（与其它路由一致，挂载在根路径）

  app.post("/api/episodes/:id/favorite", async (c) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleFavorite(c.get("userId") as string, ep.id);
    return c.json(result);
  });

  app.delete("/api/episodes/:id/favorite", async (c) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleFavorite(c.get("userId") as string, ep.id);
    return c.json(result);
  });

  app.post("/api/episodes/:id/like", async (c) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleLike(c.get("userId") as string, ep.id);
    return c.json(result);
  });

  app.delete("/api/episodes/:id/like", async (c) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleLike(c.get("userId") as string, ep.id);
    return c.json(result);
  });

  app.get("/api/me/favorites", async (c) => {
    const rows = await repo.listFavorites(c.get("userId") as string);
    return c.json(rows);
  });

  return app;
}

/** drizzle 实现：toggle（有则删、无则插），返回最终状态 */
export function createFavoritesRepo(db: PostgresJsDatabase<typeof schema>): FavoritesRepo {
  return {
    async getPublishableEpisode(id) {
      const rows = await db
        .select({ id: schema.episodes.id, userId: schema.episodes.userId })
        .from(schema.episodes)
        .where(and(eq(schema.episodes.id, id), eq(schema.episodes.status, "published")))
        .limit(1);
      return rows[0] ?? null;
    },

    async toggleFavorite(userId, episodeId) {
      const existing = await db
        .select({ id: schema.favorites.id })
        .from(schema.favorites)
        .where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.episodeId, episodeId)))
        .limit(1);
      if (existing.length > 0) {
        await db.delete(schema.favorites).where(eq(schema.favorites.id, existing[0].id));
        return { favorited: false };
      }
      await db.insert(schema.favorites).values({ userId, episodeId });
      return { favorited: true };
    },

    async toggleLike(userId, episodeId) {
      const existing = await db
        .select({ id: schema.likes.id })
        .from(schema.likes)
        .where(and(eq(schema.likes.userId, userId), eq(schema.likes.episodeId, episodeId)))
        .limit(1);
      if (existing.length > 0) {
        await db.delete(schema.likes).where(eq(schema.likes.id, existing[0].id));
        return { liked: false };
      }
      await db.insert(schema.likes).values({ userId, episodeId });
      return { liked: true };
    },

    async listFavorites(userId) {
      return db
        .select({
          episodeId: schema.episodes.id,
          title: schema.episodes.title,
          audioUrl: schema.episodes.audioUrl,
          durationSeconds: schema.episodes.durationSeconds,
          publishedAt: schema.episodes.publishedAt,
          favoritedAt: schema.favorites.createdAt,
        })
        .from(schema.favorites)
        .innerJoin(schema.episodes, eq(schema.favorites.episodeId, schema.episodes.id))
        .where(eq(schema.favorites.userId, userId))
        .orderBy(desc(schema.favorites.createdAt));
    },
  };
}
