// 消费端互动（简化版，0034）：仅保留点赞（likes）+ 当前用户互动状态。
// 收藏已整体移除（播放列表覆盖）；播放统计已移除（无 /stats 端点）。
// interactions 合并返回点赞状态 + 计数——前端一个请求即得（无独立 stats 端点）。
import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { and, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

export interface FavoritesRepo {
  /** episode 存在校验（任意用户视角：published 才可互动） */
  getPublishableEpisode(id: string): Promise<{ id: string; userId: string } | null>;
  /** toggle 点赞后返回最终状态 + 该 episode 的最新点赞数 */
  toggleLike(userId: string, episodeId: string): Promise<{ liked: boolean; likes: number }>;
  /** 当前用户点赞状态 + 最新计数（简化合并；无独立统计端点） */
  getInteractions(userId: string, episodeId: string): Promise<{ liked: boolean; likes: number }>;
}

export function favoritesRoutes(repo: FavoritesRepo) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  const likePost = createRoute({
    method: "post",
    path: "/v1/episodes/:id/like",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { content: { "application/json": { schema: z.object({ liked: z.boolean(), likes: z.number() }) } }, description: "点赞后最终状态 + 最新计数" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(likePost, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(await repo.toggleLike(c.get("userId") as string, ep.id));
  }) as unknown as RouteHandler<typeof likePost, { Variables: { userId: string } }>);

  const likeDel = createRoute({
    method: "delete",
    path: "/v1/episodes/:id/like",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { content: { "application/json": { schema: z.object({ liked: z.boolean(), likes: z.number() }) } }, description: "取消点赞后最终状态 + 最新计数" },
      404: { content: { "application/json": { schema: Err } }, description: "节目不存在" },
    },
  });
  app.openapi(likeDel, (async (c: Context) => {
    const ep = await repo.getPublishableEpisode(c.req.param("id")!);
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(await repo.toggleLike(c.get("userId") as string, ep.id));
  }) as unknown as RouteHandler<typeof likeDel, { Variables: { userId: string } }>);

  // 当前用户点赞状态 + 计数（详情页按钮初始化用；未登录 401）
  const interactions = createRoute({
    method: "get",
    path: "/v1/episodes/:id/interactions",
    request: { params: z.object({ id: z.string().min(1) }) },
    responses: {
      200: { content: { "application/json": { schema: z.object({ liked: z.boolean(), likes: z.number() }) } }, description: "当前用户点赞状态 + 最新计数" },
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

/** drizzle 实现：仅点赞（likes 表） */
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
      const [like, countRow] = await Promise.all([
        db
          .select({ id: schema.likes.id })
          .from(schema.likes)
          .where(and(eq(schema.likes.userId, userId), eq(schema.likes.episodeId, episodeId)))
          .limit(1),
        db
          .select({ n: count() })
          .from(schema.likes)
          .where(eq(schema.likes.episodeId, episodeId)),
      ]);
      return { liked: like.length > 0, likes: countRow[0]?.n ?? 0 };
    },
  };
}
