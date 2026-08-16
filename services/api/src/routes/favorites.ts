import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { and, count, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// 消费端互动（计划 6）：收藏/点赞 toggle + 我的收藏列表。
// 两站共用：SSR 站（server 转发 cookie）与 SPA 站（Bearer/cookie）都调这些端点。

export interface FavoritesRepo {
  /** episode 存在校验（任意用户视角：published 才可互动） */
  getPublishableEpisode(id: string): Promise<{ id: string; userId: string } | null>;
  /** toggle 后返回最终状态 + 该 episode 的最新计数（供按钮直接展示） */
  toggleFavorite(userId: string, episodeId: string): Promise<{ favorited: boolean; favorites: number }>;
  toggleLike(userId: string, episodeId: string): Promise<{ liked: boolean; likes: number }>;
  /** 当前用户对该 episode 的互动状态（未互动 → false/false） */
  getInteractions(userId: string, episodeId: string): Promise<{ liked: boolean; favorited: boolean }>;
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
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });
  // 路径自带 /api 前缀（与其它路由一致，挂载在根路径）

  const favPost = createRoute({
    method: "post",
    path: "/v1/episodes/:id/favorite",
    request: { params: z.object({ id: z.string().min(1) }) },    responses: {
      200: { content: { "application/json": { schema: z.object({ favorited: z.boolean(), favorites: z.number() }) } }, description: "收藏后最终状态 + 最新计数" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(favPost, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleFavorite(c.get("userId") as string, ep.id);
    return c.json(result);
  }) as unknown as RouteHandler<typeof favPost, { Variables: { userId: string } }>);

  const favDel = createRoute({
    method: "delete",
    path: "/v1/episodes/:id/favorite",
    request: { params: z.object({ id: z.string().min(1) }) },    responses: {
      200: { content: { "application/json": { schema: z.object({ favorited: z.boolean(), favorites: z.number() }) } }, description: "取消收藏后最终状态 + 最新计数" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(favDel, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleFavorite(c.get("userId") as string, ep.id);
    return c.json(result);
  }) as unknown as RouteHandler<typeof favDel, { Variables: { userId: string } }>);

  const likePost = createRoute({
    method: "post",
    path: "/v1/episodes/:id/like",
    request: { params: z.object({ id: z.string().min(1) }) },    responses: {
      200: { content: { "application/json": { schema: z.object({ liked: z.boolean(), likes: z.number() }) } }, description: "点赞后最终状态 + 最新计数" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(likePost, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleLike(c.get("userId") as string, ep.id);
    return c.json(result);
  }) as unknown as RouteHandler<typeof likePost, { Variables: { userId: string } }>);

  const likeDel = createRoute({
    method: "delete",
    path: "/v1/episodes/:id/like",
    request: { params: z.object({ id: z.string().min(1) }) },    responses: {
      200: { content: { "application/json": { schema: z.object({ liked: z.boolean(), likes: z.number() }) } }, description: "取消点赞后最终状态 + 最新计数" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(likeDel, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    const result = await repo.toggleLike(c.get("userId") as string, ep.id);
    return c.json(result);
  }) as unknown as RouteHandler<typeof likeDel, { Variables: { userId: string } }>);

  const favList = createRoute({
    method: "get",
    path: "/v1/me/favorites",
    responses: {
      200: { content: { "application/json": { schema: z.array(z.any()) } }, description: "我的收藏列表" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(favList, (async (c: Context) => {
    const rows = await repo.listFavorites(c.get("userId") as string);
    return c.json(rows);
  }) as unknown as RouteHandler<typeof favList, { Variables: { userId: string } }>);

  // 当前用户互动状态（like/favorite）：详情页按钮初始化用（未登录 401）
  const interactions = createRoute({
    method: "get",
    path: "/v1/episodes/:id/interactions",
    request: { params: z.object({ id: z.string().min(1) }) },    responses: {
      200: { content: { "application/json": { schema: z.object({ liked: z.boolean(), favorited: z.boolean() }) } }, description: "当前用户互动状态" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(interactions, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(await repo.getInteractions(c.get("userId") as string, ep.id));
  }) as unknown as RouteHandler<typeof interactions, { Variables: { userId: string } }>);

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
      } else {
        await db.insert(schema.favorites).values({ userId, episodeId });
      }
      const [row] = await db
        .select({ n: count() })
        .from(schema.favorites)
        .where(eq(schema.favorites.episodeId, episodeId));
      return { favorited: existing.length === 0, favorites: row?.n ?? 0 };
    },

    async toggleLike(userId, episodeId) {
      const existing = await db
        .select({ id: schema.likes.id })
        .from(schema.likes)
        .where(and(eq(schema.likes.userId, userId), eq(schema.likes.episodeId, episodeId)))
        .limit(1);
      if (existing.length > 0) {
        await db.delete(schema.likes).where(eq(schema.likes.id, existing[0].id));
      } else {
        await db.insert(schema.likes).values({ userId, episodeId });
      }
      const [row] = await db
        .select({ n: count() })
        .from(schema.likes)
        .where(eq(schema.likes.episodeId, episodeId));
      return { liked: existing.length === 0, likes: row?.n ?? 0 };
    },

    async getInteractions(userId, episodeId) {
      const [like, fav] = await Promise.all([
        db
          .select({ id: schema.likes.id })
          .from(schema.likes)
          .where(and(eq(schema.likes.userId, userId), eq(schema.likes.episodeId, episodeId)))
          .limit(1),
        db
          .select({ id: schema.favorites.id })
          .from(schema.favorites)
          .where(and(eq(schema.favorites.userId, userId), eq(schema.favorites.episodeId, episodeId)))
          .limit(1),
      ]);
      return { liked: like.length > 0, favorited: fav.length > 0 };
    },

    async listFavorites(userId) {
      return db
        .select({
          episodeId: schema.episodes.id,
          slug: schema.episodes.slug,
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
