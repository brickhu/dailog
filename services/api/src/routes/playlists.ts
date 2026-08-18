// 播放列表路由（内容类型，0032）：
//  公开   /v1/public/playlists*        —— 平台公开列表索引 + 详情（免鉴权，app.ts 在鉴权中间件之前挂载）
//  我的   /v1/me/playlists*            —— 用户自建列表 CRUD + 条目管理（登录 + 归属校验，挂在认证中间件之后）
//  编辑   /v1/editor/playlists*        —— 平台策展列表 CRUD + 条目管理（requireRole(editor|admin)）
// 归属校验统一 404（不泄露他人列表存在性）；节目入列表前校验公开（仅已发布公开节目可收录）。
import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { requireRole, type AuthEnv } from "../middleware/auth";
import type { PlaylistRow, Repos } from "../repo";
import type { AudioStorage } from "../storage";

const Err = z.object({ error: z.string() });

/** 校验 uuid 格式（非法格式直接 404，避免 Postgres 22P02 → 500）——与 app.ts 一致 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// 公开（免鉴权）
// ---------------------------------------------------------------------------

export function playlistPublicRoutes(repo: Repos) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();

  /** 平台公开列表索引（lang 语言偏好优先 + 精选优先；附带节目数与首期封面） */
  const rList = createRoute({
    method: "get",
    path: "/v1/public/playlists",
    request: {
      query: z.object({
        lang: z.string().optional().openapi({ example: "zh", description: "语言偏好（zh/en）——同语言列表优先，不足自然回退" }),
        limit: z.string().optional().openapi({ default: "20", description: "数量 1-50（handler 内转换）" }),
      }),
    },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "平台公开播放列表（语言偏好 + 精选优先）" },
    },
  });
  app.openapi(rList, (async (c: Context) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);
    const raw = c.req.query("lang");
    const lang = typeof raw === "string" && /^[a-z]{2,3}$/i.test(raw) ? raw.toLowerCase() : undefined;
    return c.json(await repo.playlists.listPublic({ lang, limit }));
  }) as unknown as RouteHandler<typeof rList, { Variables: { userId: string } }>);

  /** 列表详情（含公开节目，position 排序）——/playlist/<slug> 页 SSR 用 */
  const rDetail = createRoute({
    method: "get",
    path: "/v1/public/playlists/:slug",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "播放列表详情（含公开节目）" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在或未公开" },
    },
  });
  app.openapi(rDetail, (async (c: Context) => {
    const pl = await repo.playlists.getPublicBySlug(c.req.param("slug")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    return c.json(pl);
  }) as unknown as RouteHandler<typeof rDetail, { Variables: { userId: string } }>);

  return app;
}

// ---------------------------------------------------------------------------
// 我的（登录 + 归属校验）
// ---------------------------------------------------------------------------

const PlaylistCreateBody = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  isPublic: z.boolean().optional(),
});

export function playlistUserRoutes(repo: Repos) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();

  /** 归属校验：uuid 格式 + 存在 + 属于当前用户；失败返回 null */
  async function owned(id: string, userId: string): Promise<PlaylistRow | null> {
    if (!UUID_RE.test(id)) return null;
    const pl = await repo.playlists.getById(id);
    if (!pl || pl.ownerId !== userId) return null;
    return pl;
  }

  /** 校验节目可收录：uuid 格式 + 已发布公开（未公开/不存在 → null） */
  async function publicEpisodeId(episodeId: string): Promise<boolean> {
    if (!UUID_RE.test(episodeId)) return false;
    return (await repo.episodes.getPublicAudioKey(episodeId)) !== null;
  }

  // GET /v1/me/playlists —— 我的列表（含私有）；?contains=<episodeId> 附带收录标记
  const rList = createRoute({
    method: "get",
    path: "/v1/me/playlists",
    request: {
      query: z.object({
        contains: z.string().optional().openapi({ description: "可选：节目 id（uuid）——返回每列表是否已收录该节目" }),
      }),
    },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "我的播放列表" },
    },
  });
  app.openapi(rList, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const raw = c.req.query("contains");
    const contains = raw && UUID_RE.test(raw) ? raw : undefined;
    return c.json(await repo.playlists.listByUser(userId, contains ? { containsEpisodeId: contains } : undefined));
  }) as unknown as RouteHandler<typeof rList, { Variables: { userId: string } }>);

  // POST /v1/me/playlists —— 创建用户列表
  const rCreate = createRoute({
    method: "post",
    path: "/v1/me/playlists",
    request: { body: { content: { "application/json": { schema: PlaylistCreateBody } } } },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "创建成功（id + slug）" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法" },
    },
  });
  app.openapi(rCreate, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { title?: unknown; description?: unknown; isPublic?: unknown } | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 80) return c.json({ error: "invalid_input", detail: "标题 1-80 字" }, 400);
    const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) : null;
    const isPublic = typeof body?.isPublic === "boolean" ? body.isPublic : true;
    const created = await repo.playlists.create({ kind: "user", ownerId: userId, title, description, isPublic });
    return c.json(created);
  }) as unknown as RouteHandler<typeof rCreate, { Variables: { userId: string } }>);

  // GET /v1/me/playlists/:id —— 单个（含全部条目）
  const rGet = createRoute({
    method: "get",
    path: "/v1/me/playlists/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "播放列表（含条目）" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在或非本人" },
    },
  });
  app.openapi(rGet, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const pl = await owned(c.req.param("id")!, userId);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const episodes = await repo.playlists.listEpisodes(pl.id);
    return c.json({ ...pl, episodes });
  }) as unknown as RouteHandler<typeof rGet, { Variables: { userId: string } }>);

  // PATCH /v1/me/playlists/:id —— 编辑（title/description/isPublic）
  const rPatch = createRoute({
    method: "patch",
    path: "/v1/me/playlists/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已更新" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在或非本人" },
    },
  });
  app.openapi(rPatch, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const pl = await owned(c.req.param("id")!, userId);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { title?: unknown; description?: unknown; isPublic?: unknown } | null;
    if (!body || Object.keys(body).length === 0) return c.json({ error: "invalid_input", detail: "无更新字段" }, 400);
    const patch: { title?: string; description?: string | null; isPublic?: boolean } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 80) {
        return c.json({ error: "invalid_input", detail: "标题 1-80 字" }, 400);
      }
      patch.title = body.title.trim();
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") return c.json({ error: "invalid_input" }, 400);
      patch.description = body.description === null ? null : String(body.description).slice(0, 500);
    }
    if (body.isPublic !== undefined) {
      if (typeof body.isPublic !== "boolean") return c.json({ error: "invalid_input" }, 400);
      patch.isPublic = body.isPublic;
    }
    await repo.playlists.update(pl.id, patch);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rPatch, { Variables: { userId: string } }>);

  // DELETE /v1/me/playlists/:id —— 删除（级联清条目）
  const rDelete = createRoute({
    method: "delete",
    path: "/v1/me/playlists/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已删除" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在或非本人" },
    },
  });
  app.openapi(rDelete, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const pl = await owned(c.req.param("id")!, userId);
    if (!pl) return c.json({ error: "not_found" }, 404);
    await repo.playlists.remove(pl.id);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rDelete, { Variables: { userId: string } }>);

  // POST /v1/me/playlists/:id/episodes —— 添加节目（校验公开；重复幂等）
  const rAdd = createRoute({
    method: "post",
    path: "/v1/me/playlists/:id/episodes",
    request: { body: { content: { "application/json": { schema: z.object({ episodeId: z.string().min(1) }) } } } },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已添加（added=false 表示已在列表）" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法 / 节目不可收录" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在或非本人" },
    },
  });
  app.openapi(rAdd, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const pl = await owned(c.req.param("id")!, userId);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { episodeId?: unknown } | null;
    const episodeId = typeof body?.episodeId === "string" ? body.episodeId : "";
    if (!episodeId) return c.json({ error: "invalid_input", detail: "缺少 episodeId" }, 400);
    if (!(await publicEpisodeId(episodeId))) {
      return c.json({ error: "episode_not_public", detail: "仅已发布公开节目可收录" }, 400);
    }
    const { added } = await repo.playlists.addEpisode(pl.id, episodeId);
    return c.json({ ok: true, added });
  }) as unknown as RouteHandler<typeof rAdd, { Variables: { userId: string } }>);

  // DELETE /v1/me/playlists/:id/episodes/:episodeId —— 移除节目
  const rRemove = createRoute({
    method: "delete",
    path: "/v1/me/playlists/:id/episodes/:episodeId",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已移除" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在或非本人" },
    },
  });
  app.openapi(rRemove, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const pl = await owned(c.req.param("id")!, userId);
    if (!pl) return c.json({ error: "not_found" }, 404);
    await repo.playlists.removeEpisode(pl.id, c.req.param("episodeId")!);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rRemove, { Variables: { userId: string } }>);

  // PUT /v1/me/playlists/:id/episodes/reorder —— 重排（有序 episodeIds）
  const rReorder = createRoute({
    method: "put",
    path: "/v1/me/playlists/:id/episodes/reorder",
    request: { body: { content: { "application/json": { schema: z.object({ episodeIds: z.array(z.string()).max(200) }) } } } },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已重排" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在或非本人" },
    },
  });
  app.openapi(rReorder, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const pl = await owned(c.req.param("id")!, userId);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { episodeIds?: unknown } | null;
    const ids = Array.isArray(body?.episodeIds)
      ? (body.episodeIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length === 0) return c.json({ error: "invalid_input", detail: "episodeIds 不能为空" }, 400);
    await repo.playlists.reorder(pl.id, ids);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rReorder, { Variables: { userId: string } }>);

  return app;
}

// ---------------------------------------------------------------------------
// 编辑端（平台策展列表）
// ---------------------------------------------------------------------------

const EditorPlaylistBody = z.object({
  title: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  language: z.string().max(10).optional(),
  isPublic: z.boolean().optional(),
  isPicked: z.boolean().optional(),
});

export interface PlaylistEditorDeps {
  repo: Repos;
  /** 列表封面存储（R2/fs；键 covers/playlists/{id}.jpg） */
  storage: AudioStorage;
}

/** 列表封面上传上限（8MB——正常封面远小于此，纯防滥用） */
const MAX_COVER_BYTES = 8 * 1024 * 1024;

export function playlistEditorRoutes(deps: PlaylistEditorDeps) {
  const repo = deps.repo;
  const app = new OpenAPIHono<AuthEnv>();
  // 段级通配（Hono 不支持段内后缀 *；与 editorRoutes 的守卫同形，重复施加无副作用）
  app.use("/v1/editor/*", requireRole("editor"));

  /** 编辑端单查（含私有草稿）；不存在 → null */
  async function get(id: string) {
    if (!UUID_RE.test(id)) return null;
    return repo.playlists.getById(id);
  }

  // GET /v1/editor/playlists —— 全部平台列表（含未公开草稿态）
  const rList = createRoute({
    method: "get",
    path: "/v1/editor/playlists",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "全部平台播放列表" },
    },
  });
  app.openapi(rList, (async (c: Context) => {
    return c.json(await repo.playlists.listEditor());
  }) as unknown as RouteHandler<typeof rList, AuthEnv>);

  // POST /v1/editor/playlists —— 创建平台列表
  const rCreate = createRoute({
    method: "post",
    path: "/v1/editor/playlists",
    request: { body: { content: { "application/json": { schema: EditorPlaylistBody } } } },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "创建成功（id + slug）" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法" },
    },
  });
  app.openapi(rCreate, (async (c: Context) => {
    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown; description?: unknown; language?: unknown; isPublic?: unknown; isPicked?: unknown;
    } | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title || title.length > 80) return c.json({ error: "invalid_input", detail: "标题 1-80 字" }, 400);
    const created = await repo.playlists.create({
      kind: "platform",
      ownerId: c.get("userId") as string,
      title,
      description: typeof body?.description === "string" ? body.description.trim().slice(0, 500) : null,
      language: typeof body?.language === "string" && body.language ? body.language.slice(0, 10) : "zh",
      isPublic: typeof body?.isPublic === "boolean" ? body.isPublic : true,
      isPicked: typeof body?.isPicked === "boolean" ? body.isPicked : false,
    });
    return c.json(created);
  }) as unknown as RouteHandler<typeof rCreate, AuthEnv>);

  // GET /v1/editor/playlists/:id —— 平台列表详情（含全部条目——CLI playlist episodes 用）
  const rGet = createRoute({
    method: "get",
    path: "/v1/editor/playlists/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "平台播放列表（含条目）" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rGet, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const episodes = await repo.playlists.listEpisodes(pl.id);
    return c.json({ ...pl, episodes });
  }) as unknown as RouteHandler<typeof rGet, AuthEnv>);

  // PATCH /v1/editor/playlists/:id —— 编辑平台列表
  const rPatch = createRoute({
    method: "patch",
    path: "/v1/editor/playlists/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已更新" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rPatch, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as {
      title?: unknown; description?: unknown; language?: unknown; isPublic?: unknown; isPicked?: unknown;
    } | null;
    if (!body || Object.keys(body).length === 0) return c.json({ error: "invalid_input", detail: "无更新字段" }, 400);
    const patch: { title?: string; description?: string | null; isPublic?: boolean; isPicked?: boolean; language?: string } = {};
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > 80) {
        return c.json({ error: "invalid_input", detail: "标题 1-80 字" }, 400);
      }
      patch.title = body.title.trim();
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") return c.json({ error: "invalid_input" }, 400);
      patch.description = body.description === null ? null : String(body.description).slice(0, 500);
    }
    if (body.isPublic !== undefined) {
      if (typeof body.isPublic !== "boolean") return c.json({ error: "invalid_input" }, 400);
      patch.isPublic = body.isPublic;
    }
    if (body.isPicked !== undefined) {
      if (typeof body.isPicked !== "boolean") return c.json({ error: "invalid_input" }, 400);
      patch.isPicked = body.isPicked;
    }
    if (body.language !== undefined) {
      if (typeof body.language !== "string") return c.json({ error: "invalid_input" }, 400);
      patch.language = body.language.slice(0, 10);
    }
    await repo.playlists.update(pl.id, patch);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rPatch, AuthEnv>);

  // DELETE /v1/editor/playlists/:id
  const rDelete = createRoute({
    method: "delete",
    path: "/v1/editor/playlists/:id",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已删除" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rDelete, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    await repo.playlists.remove(pl.id);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rDelete, AuthEnv>);

  // POST /v1/editor/playlists/:id/episodes —— 添加节目
  const rAdd = createRoute({
    method: "post",
    path: "/v1/editor/playlists/:id/episodes",
    request: { body: { content: { "application/json": { schema: z.object({ episodeId: z.string().min(1) }) } } } },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已添加（added=false 表示已在列表）" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法 / 节目不可收录" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rAdd, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { episodeId?: unknown } | null;
    const episodeId = typeof body?.episodeId === "string" ? body.episodeId : "";
    if (!episodeId) return c.json({ error: "invalid_input", detail: "缺少 episodeId" }, 400);
    if (!UUID_RE.test(episodeId) || !(await repo.episodes.getPublicAudioKey(episodeId))) {
      return c.json({ error: "episode_not_public", detail: "仅已发布公开节目可收录" }, 400);
    }
    const { added } = await repo.playlists.addEpisode(pl.id, episodeId);
    return c.json({ ok: true, added });
  }) as unknown as RouteHandler<typeof rAdd, AuthEnv>);

  // DELETE /v1/editor/playlists/:id/episodes/:episodeId
  const rRemove = createRoute({
    method: "delete",
    path: "/v1/editor/playlists/:id/episodes/:episodeId",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已移除" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rRemove, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    await repo.playlists.removeEpisode(pl.id, c.req.param("episodeId")!);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rRemove, AuthEnv>);

  // PUT /v1/editor/playlists/:id/episodes/reorder
  const rReorder = createRoute({
    method: "put",
    path: "/v1/editor/playlists/:id/episodes/reorder",
    request: { body: { content: { "application/json": { schema: z.object({ episodeIds: z.array(z.string()).max(200) }) } } } },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "已重排" },
      400: { content: { "application/json": { schema: Err } }, description: "参数不合法" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rReorder, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { episodeIds?: unknown } | null;
    const ids = Array.isArray(body?.episodeIds)
      ? (body.episodeIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length === 0) return c.json({ error: "invalid_input", detail: "episodeIds 不能为空" }, 400);
    await repo.playlists.reorder(pl.id, ids);
    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof rReorder, AuthEnv>);

  // POST /v1/editor/playlists/:id/cover —— 上传列表封面（multipart cover；sharp 归一 JPEG 1400² → R2）
  const rCover = createRoute({
    method: "post",
    path: "/v1/editor/playlists/:id/cover",
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "封面上传成功（coverUrl = storage key）" },
      400: { content: { "application/json": { schema: Err } }, description: "缺少/非法封面" },
      404: { content: { "application/json": { schema: Err } }, description: "列表不存在" },
    },
  });
  app.openapi(rCover, (async (c: Context) => {
    const pl = await get(c.req.param("id")!);
    if (!pl) return c.json({ error: "not_found" }, 404);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("cover");
    if (!(file instanceof File) || file.size === 0) {
      return c.json({ error: "cover_required", detail: "缺少封面文件（multipart 字段 cover）" }, 400);
    }
    if (file.size > MAX_COVER_BYTES) {
      return c.json({ error: "cover_too_large", detail: "封面超过 8MB 上限" }, 400);
    }
    if (!file.type.startsWith("image/")) {
      return c.json({ error: "invalid_cover", detail: "仅支持图片文件" }, 400);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let jpeg: Uint8Array;
    try {
      const { default: sharp } = await import("sharp");
      jpeg = new Uint8Array(await sharp(bytes).resize(1400, 1400, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer());
    } catch {
      return c.json({ error: "invalid_cover", detail: "无法解析的图片文件" }, 400);
    }
    const key = `covers/playlists/${pl.id}.jpg`;
    await deps.storage.put(key, new Uint8Array(jpeg));
    await repo.playlists.update(pl.id, { coverUrl: key });
    return c.json({ ok: true, coverUrl: key });
  }) as unknown as RouteHandler<typeof rCover, AuthEnv>);

  return app;
}
