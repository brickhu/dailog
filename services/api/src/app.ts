import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { Env } from "./config/env";
import { createAuthMiddleware, type AuthEnv, type AuthLike } from "./middleware/auth";
import { createCorsMiddleware } from "./middleware/cors";
import { profileRoutes } from "./routes/profile";
import { submissionsRoutes } from "./routes/submissions";
import { notificationsRoutes } from "./routes/notifications";
import { meEpisodesRoutes } from "./routes/me-episodes";
import { authExtRoutes } from "./routes/auth-ext";
import { voiceRoutes, type VoiceDeps } from "./routes/voice";
import { favoritesRoutes, type FavoritesRepo } from "./routes/favorites";
import { editorRoutes, type EditorDeps } from "./routes/editor";
import { devicePublicRoutes, deviceApproveRoutes, createDeviceStore, type DeviceStore } from "./routes/device";
import { ttsRoutes, type TtsDeps } from "./routes/tts";
import { playlistPublicRoutes, myFavoritesRoutes, playlistEditorRoutes } from "./routes/playlists";
import type { Repos } from "./repo";

export type { AuthLike };
export type AppDeps = {
  env: Env;
  auth: AuthLike; // better-auth 实例（/api/auth/* 处理器 + 认证中间件）
  repo: Repos;
  voice: VoiceDeps; // 声音采样（用户上传/回读）+ 公开音频/封面读取共用 storage
  favorites: FavoritesRepo; // 消费端互动（收藏/点赞）
  editor: EditorDeps; // 编辑端（本地 Agent 工作流）
  /** auth-ext 统一登录/注册端点依赖（缺省由 app 内 db + auth 组装） */
  authExt?: { env: unknown; db: unknown; auth: unknown };
  /** 设备授权存储（编辑本地 Agent 登录；缺省 app 内建） */
  deviceStore?: DeviceStore;
  /** 统一 TTS（编辑本地不直连 Fish——密钥只在服务端） */
  tts: TtsDeps;
};

// —— OpenAPI 文档（GET /doc JSON + GET /doc Swagger UI）——
const ErrorResp = z.object({ error: z.string() }).openapi("Error");
const IdParam = z.object({ id: z.string().min(1) }).openapi("IdParam");
const OkResp = z.object({ ok: z.boolean() }).openapi("Ok");

export function createApp(deps: AppDeps): OpenAPIHono<AuthEnv> {
  const app = new OpenAPIHono<AuthEnv>();
  const deviceStore = deps.deviceStore ?? createDeviceStore();

  // API 文档：JSON 定义 + Swagger UI（可交互调试）
  app.doc("/doc", {
    openapi: "3.1.0",
    info: { title: "Dailog API", version: "1.0.0", description: "Dailog 播客站服务端 API（公开端点 + 登录后端点）" },
  });
  app.get("/doc/ui", swaggerUI({ url: "/doc" }));

  // 跨域（本地 dev + 生产 app.dailog.fm）；OPTIONS 预检在此统一 204。
  // 必须先于其它路由注册（Hono middleware 顺序敏感），否则先注册的路由不经 CORS
  const appOrigins = deps.env.APP_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use("*", createCorsMiddleware(appOrigins));

  app.openapi(createRoute({
    method: "get",
    path: "/health",
    responses: { 200: { content: { "application/json": { schema: OkResp } }, description: "健康检查" } },
  }), (c) => c.json({ ok: true }));

  // 统一登录/注册（老用户密码登录 / 新用户验证码注册）——必须先于 better-auth
  // 的 /api/auth/* 全捕获注册（Hono 先注册先匹配，否则被吞返回 404）
  app.route("/", authExtRoutes(deps.authExt as never));

  // better-auth 会话路由（注册/登录/登出/get-session）：挂在认证中间件之前，免鉴权
  app.on(["POST", "GET"], "/v1/auth/*", (c) => deps.auth.handler(c.req.raw));

  // 设备授权流公开端点（创建授权码 / 授权页 / 配对码换 token）：免鉴权——必须在认证中间件之前注册
  app.route("/", devicePublicRoutes(
    deviceStore,
    deps.env,
    deps.auth,
    async (userId) => (await deps.repo.episodes.getRole?.(userId)) ?? null,
  ));

  // 主站公开端点（免鉴权）：仅已发布公开节目可读——必须在鉴权中间件之前注册
  // id 列是 uuid 类型：非法格式（旧短 id/任意字符串）直接 404，避免 Postgres 抛 22P02 → 500
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // 封面缩放规格（?w=）：白名单防滥用；响应式图片按视口选规格，避免每张卡拉原图
  const COVER_WIDTHS = new Set([160, 320, 480, 640, 960, 1280]);
  // 音频开放区间（bytes=N-）单次响应上限：节目 2-10MB，实际总是一次回到文件尾；
  // 该上限只为超大文件兜底（避免一次性进内存），不是分片策略——切勿再调小成 1MiB
  const RANGE_MAX_SPAN = 32 * 1024 * 1024;
  // 缩放结果内存缓存（key `cover:{id}:{w}`；原图已有磁盘缓存，缩放结果小、命中即毫秒）
  const coverResizeCache = new Map<string, { data: Uint8Array; total: number }>();
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/episodes/:id/cover",
    request: {
      params: IdParam,
      query: z.object({
        w: z.string().optional().openapi({ description: "可选缩放宽度（160/320/480/640/960/1280，居中裁方 JPEG q80）；缺省返回原图" }),
      }),
    },
    responses: {
      200: { content: { "image/jpeg": { schema: z.any() } }, description: "节目封面图（公开，缓存 86400s）" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "封面不存在" },
    },
  }), async (c) => {
    if (!UUID_RE.test(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    const cover = await deps.repo.episodes.getPublicCoverKey(c.req.param("id"));
    if (!cover) return c.json({ error: "not_found" }, 404);
    const wRaw = c.req.query("w");
    const w = wRaw && COVER_WIDTHS.has(Number(wRaw)) ? Number(wRaw) : null;
    try {
      if (w) {
        // 缩放规格：内存缓存命中直出；未命中读原图 → sharp 居中裁方 → 缓存
        const cacheKey = `cover:${c.req.param("id")}:${w}`;
        const hit = coverResizeCache.get(cacheKey);
        if (hit) {
          return new Response(hit.data as unknown as BodyInit, {
            headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
          });
        }
        const { data } = await deps.voice.storage.get(cover);
        if (!data) return c.json({ error: "not_found" }, 404);
        const { default: sharp } = await import("sharp");
        const resized = await sharp(data).resize(w, w, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
        if (coverResizeCache.size > 200) coverResizeCache.clear(); // 简单上限兜底
        coverResizeCache.set(cacheKey, { data: new Uint8Array(resized), total: resized.length });
        return new Response(resized as unknown as BodyInit, {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
        });
      }
      const { data } = await deps.voice.storage.get(cover);
      if (!data) return c.json({ error: "not_found" }, 404);
      return new Response(data as unknown as BodyInit, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });
  // 节目台本（公开）：scripts/{submissionId}.json（打磨脚本文件引用——节目页拉取后去情绪标签展示）
  const publicScriptRoute = createRoute({
    method: "get",
    path: "/v1/public/scripts/:id",
    request: { params: IdParam },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "打磨脚本 JSON（segments）" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "脚本不存在" },
    },
  });
  app.openapi(publicScriptRoute, (async (c: Context) => {
    const sid = c.req.param("id")!;   // id = submissionId
    if (!UUID_RE.test(sid)) return c.json({ error: "not_found" }, 404);
    const bytes = await deps.voice.storage.get(`scripts/${sid}.json`).then((r) => r.data).catch(() => null);
    if (!bytes) return c.json({ error: "not_found" }, 404);
    return new Response(bytes as unknown as BodyInit, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }) as unknown as RouteHandler<typeof publicScriptRoute, AuthEnv>);

  // 播放列表封面（公开）：仅公开列表可读；缓存 86400s（与单集封面同模式）
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/playlists/:id/cover",
    request: { params: IdParam },
    responses: {
      200: { content: { "image/jpeg": { schema: z.any() } }, description: "播放列表封面（公开，缓存 86400s）" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "封面不存在" },
    },
  }), async (c) => {
    if (!UUID_RE.test(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    const cover = await deps.repo.playlists.getPublicCover(c.req.param("id"));
    if (!cover) return c.json({ error: "not_found" }, 404);
    try {
      const { data } = await deps.voice.storage.get(cover);
      if (!data) return c.json({ error: "not_found" }, 404);
      return new Response(data as unknown as BodyInit, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/episodes/:id/audio",
    request: { params: IdParam },
    responses: {
      200: { content: { "audio/mpeg": { schema: z.any() } }, description: "节目音频全量（缓存 604800s，ETag 304）" },
      206: { content: { "audio/mpeg": { schema: z.any() } }, description: "Range 分片（浏览器流式播放/seek）" },
      304: { description: "If-None-Match 命中（未修改）" },
      416: { description: "Range 越界" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "音频不存在" },
    },
  }), async (c) => {
    if (!UUID_RE.test(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    const audio = await deps.repo.episodes.getPublicAudioKey(c.req.param("id"));
    if (!audio) return c.json({ error: "not_found" }, 404);
    // ETag 按发布时间：重新制作发布是新 episode → 内容变化 → 浏览器重新拉取；未变 → 304 省流量
    const etag = `"${audio.version}"`;
    if (c.req.header("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    try {
      // Content-Type 按存储 key 后缀（mp3/m4a 双格式兼容；已发布老节目是 mp3）
      const audioContentType = audio.audioKey.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg";
      // 缓存策略：站点播放用的 URL 带 ?v=<publishedAt>（内容变即换 URL）→ 长缓存且不校验；
      // 裸 URL（RSS/外链/历史书签）内容可变（重新发布会覆盖同一路径），必须每次校验——
      // 否则浏览器缓存里一旦存下旧版本、或"读到某字节就断"的坏副本，用户会被钉死整整 7 天，
      // 服务端怎么修都传不到他那里。ETag 命中只是 304 空响应，成本可忽略
      const baseHeaders = {
        "Content-Type": audioContentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": c.req.query("v")
          ? "public, max-age=604800, immutable"
          : "public, max-age=0, must-revalidate",
        ETag: etag,
      };
      const storage = deps.voice.storage;
      // Range 分片（浏览器流式播放/seek 依赖 206）：storage 层有磁盘缓存——
      // 命中本地→流式直读（毫秒，不整块进内存）；未命中→远端分片快速响应 + 后台单飞落盘。
      // 只接受带明确起点的区间；bytes=-N（尾部区间）语法有效但本端点不支持 → 按 RFC 忽略 Range 返回 200。
      const range = c.req.header("range");
      const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range.trim()) : null;
      const start = m ? parseInt(m[1], 10) : 0;
      const explicitEnd = m && m[2] ? parseInt(m[2], 10) : null;
      // 开放区间（bytes=N-，Safari/Firefox/部分播放器常用）一律给到文件尾：
      // 旧实现每次只回 1MiB，一集要 8 次往返，任何一次挂住/失败播放就永久停在分片边界
      // （症状：总时长 5:23，播到 5:05 卡死不报错）。RANGE_MAX_SPAN 只是超大文件的内存兜底。
      const end = explicitEnd ?? start + RANGE_MAX_SPAN - 1;
      // 非法区间（终点小于起点）：按 RFC 7233 忽略 Range，退回 200 全量
      const validRange = m !== null && Number.isFinite(start) && Number.isFinite(end) && start <= end;
      if (validRange) {
        const streamed = await storage.getStream?.(audio.audioKey, { start, end });
        if (streamed) {
          return new Response(streamed.body as unknown as BodyInit, {
            status: 206,
            headers: {
              ...baseHeaders,
              "Content-Range": `bytes ${streamed.start}-${streamed.end}/${streamed.total}`,
              "Content-Length": String(streamed.end - streamed.start + 1),
            },
          });
        }
        const r = await storage.get(audio.audioKey, { start, end });
        const total = r.total;
        if (start >= total || r.data.length === 0) {
          return new Response(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${total}` } });
        }
        return new Response(r.data as unknown as BodyInit, {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${start + r.data.length - 1}/${total}`,
            "Content-Length": String(r.data.length),
          },
        });
      }
      // 无 Range（或忽略非法 Range）：全量——命中缓存流式下发，未命中远端拉取后落盘
      const streamedFull = await storage.getStream?.(audio.audioKey);
      if (streamedFull) {
        return new Response(streamedFull.body as unknown as BodyInit, {
          headers: { ...baseHeaders, "Content-Length": String(streamedFull.total) },
        });
      }
      const full = await storage.get(audio.audioKey);
      return new Response(full.data as unknown as BodyInit, {
        headers: { ...baseHeaders, "Content-Length": String(full.total) },
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  // 播放/完播上报 + 统计读取（公开播放器；仅已发布公开节目）——0036 恢复展示。
  // 鉴权策略：免登录（未登录听众也计入，保证统计口径）；防刷 = 前端 session 级去重
  // + 服务端同 IP 同节目 5 分钟窗口限频（内存表；服务重启清空可接受，防 curl 连刷）
  const statCooldown = new Map<string, number>();
  const STAT_WINDOW_MS = 5 * 60 * 1000;
  const statKey = (ip: string, id: string, type: string) => `${ip}:${id}:${type}`;
  const statsPostRoute = createRoute({
    method: "post",
    path: "/v1/public/episodes/:id/stats/:type",
    request: {
      params: z.object({ id: z.string().min(1), type: z.string().openapi({ example: "play", description: "play 或 completion" }) }),
    },
    responses: {
      200: { content: { "application/json": { schema: OkResp } }, description: "上报成功（含窗口内去重静默）" },
      400: { content: { "application/json": { schema: ErrorResp } }, description: "type 不是 play/completion" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "节目不存在" },
    },
  });
  app.openapi(statsPostRoute, (async (c) => {
    const type = c.req.param("type");
    if (type !== "play" && type !== "completion") return c.json({ error: "invalid_type" }, 400);
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return c.json({ error: "not_found" }, 404);
    const exists = await deps.repo.episodes.getPublicAudioKey(id);
    if (!exists) return c.json({ error: "not_found" }, 404);
    // 限频：同 IP 同 episode 同事件 5 分钟内只计一次（CF 代理头优先；本地无头 → 空串）。
    // ip 为空（本地直连/无代理）时跳过限频：本地所有请求共享 "" 这个 key，限频会让
    // 任何一次测试/播放阻断同节目后续 5 分钟的全部上报（开发环境互相干扰，已踩坑）
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (ip) {
      const key = statKey(ip, id, type);
      const now = Date.now();
      const last = statCooldown.get(key) ?? 0;
      if (now - last < STAT_WINDOW_MS) return c.json({ ok: true }); // 窗口内重复：静默忽略不计数
      statCooldown.set(key, now);
    }
    await deps.repo.episodes.recordStat(id, type);
    return c.json({ ok: true });
  }) as RouteHandler<typeof statsPostRoute, AuthEnv>);
  const statsGetRoute = createRoute({
    method: "get",
    path: "/v1/public/episodes/:id/stats",
    request: { params: IdParam },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "播放/完播/点赞计数" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "节目不存在" },
    },
  });
  app.openapi(statsGetRoute, (async (c) => {
    if (!UUID_RE.test(c.req.param("id"))) return c.json({ error: "not_found" }, 404);
    const exists = await deps.repo.episodes.getPublicAudioKey(c.req.param("id"));
    if (!exists) return c.json({ error: "not_found" }, 404);
    return c.json(await deps.repo.episodes.getStats(c.req.param("id")));
  }) as RouteHandler<typeof statsGetRoute, AuthEnv>);

  // 推荐队列（首页播放器/抖音流）：热度分排序；lang 优先、exclude 排除已播
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/episodes/recommended",
    request: {
      query: z.object({
        lang: z.enum(["zh", "en"]).optional().openapi({ description: "语言优先" }),
        limit: z.string().optional().openapi({ default: "20", description: "数量 1-50（handler 内转换）" }),
        exclude: z.string().optional().openapi({ description: "逗号分隔已播 slug" }),
      }),
    },
    responses: {
      200: { content: { "application/json": { schema: z.array(z.any()) } }, description: "推荐节目队列（热度分排序）" },
    },
  }), async (c) => {
    const lang = typeof c.req.query("lang") === "string" && /^[a-z]{2,3}$/i.test(c.req.query("lang") ?? "")
      ? (c.req.query("lang") as string).toLowerCase()
      : undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);
    const exclude = (c.req.query("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
    return c.json(await deps.repo.episodes.listRecommended({ lang, limit, exclude: exclude.length > 0 ? exclude : undefined }));
  });

  // 单集公开详情（详情页 SSR head OG 用）：按 slug 或 id 查，仅已发布公开。
  // 注册在 recommended 之后（同前缀具体静态路径优先；参数路由不干扰多段 /cover /audio /stats）
  const publicEpisodeRoute = createRoute({
    method: "get",
    path: "/v1/public/episodes/:idOrSlug",
    request: { params: z.object({ idOrSlug: z.string().min(1) }).openapi("IdOrSlugParam") },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "公开详情（title/cover/sourceUrl/transcript/主持人）" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "节目不存在或未公开" },
    },
  });
  app.openapi(publicEpisodeRoute, (async (c) => {
    const ep = await deps.repo.episodes.getPublicEpisode(c.req.param("idOrSlug"));
    if (!ep) return c.json({ error: "not_found" }, 404);
    return c.json(ep);
  }) as RouteHandler<typeof publicEpisodeRoute, AuthEnv>);

  // 站点头部数据（首页宣传语）——公开
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/stats",
    responses: { 200: { content: { "application/json": { schema: z.any() } }, description: "站点统计（主播/嘉宾/期数/热门标签）" } },
  }), async (c) => {
    return c.json(await deps.repo.episodes.getSiteStats());
  });
  // 热门主播（个人主页入口）——公开
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/hosts",
    request: { query: z.object({ limit: z.string().optional().openapi({ default: "8", description: "数量 1-20（handler 内转换）" }) }) },
    responses: { 200: { content: { "application/json": { schema: z.array(z.any()) } }, description: "热门主播（播放量+期数排序）" } },
  }), async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 8) || 8, 20);
    return c.json(await deps.repo.episodes.listTopHosts(limit));
  });
  // 常驻 AI 嘉宾（品牌声线宿主）——公开
  app.openapi(createRoute({
    method: "get",
    path: "/v1/public/guests",
    responses: { 200: { content: { "application/json": { schema: z.array(z.any()) } }, description: "常驻 AI 嘉宾列表" } },
  }), async (c) => {
    return c.json(await deps.repo.guests.list());
  });
  // 嘉宾详情 + 参与的节目（公开详情页 /guest/<id>）——不存在 404
  const guestRoute = createRoute({
    method: "get",
    path: "/v1/public/guests/:id",
    request: { params: IdParam },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "嘉宾详情 + 参与的节目" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "嘉宾不存在" },
    },
  });
  app.openapi(guestRoute, (async (c) => {
    const id = c.req.param("id");
    const guest = await deps.repo.guests.getById(id);
    if (!guest) return c.json({ error: "not_found" }, 404);
    const episodes = await deps.repo.episodes.listByGuest(id);
    return c.json({ guest, episodes });
  }) as RouteHandler<typeof guestRoute, AuthEnv>);

  // 投稿公开详情（公开页 /submission/<id>）：仅非敏感字段（URL/标题/状态/节目）
  const publicSubmissionRoute = createRoute({
    method: "get",
    path: "/v1/public/submissions/:id",
    request: { params: IdParam },
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "投稿公开详情" },
      404: { content: { "application/json": { schema: ErrorResp } }, description: "投稿不存在" },
    },
  });
  app.openapi(publicSubmissionRoute, (async (c: Context) => {
    // 非 uuid 直接 404（避免 uuid cast 错误 500——与 episodes 公开端点一致）
    if (!UUID_RE.test(c.req.param("id")!)) return c.json({ error: "not_found" }, 404);
    const row = await deps.repo.submissions.getPublicById(c.req.param("id")!);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(row);
  }) as unknown as RouteHandler<typeof publicSubmissionRoute, AuthEnv>);

  // 播放列表公开端点（免鉴权）：平台列表索引 + 详情——必须在鉴权中间件之前注册
  app.route("/", playlistPublicRoutes(deps.repo));

  app.use("/v1/*", createAuthMiddleware(deps.auth, async (userId) => (await deps.repo.episodes.getRole?.(userId)) ?? null));

  app.openapi(createRoute({
    method: "get",
    path: "/v1/me",
    responses: {
      200: { content: { "application/json": { schema: z.object({ userId: z.string(), role: z.string(), channelActive: z.boolean(), hasVoiceSample: z.boolean() }) } }, description: "当前登录用户概要（需登录）" },
      401: { description: "未登录" },
    },
  }), async (c) => {
    const userId = c.get("userId");
    const sample = await deps.repo.episodes.getVoiceSample(userId);
    const role = (await deps.repo.episodes.getRole?.(userId)) ?? "user";
    return c.json({ userId, role, channelActive: true, hasVoiceSample: sample !== null });
  });

  app.route("/", submissionsRoutes(deps.repo));
  app.route("/", profileRoutes({ repo: deps.repo }));
  app.route("/", notificationsRoutes(deps.repo));
  app.route("/", meEpisodesRoutes(deps.repo));
  // 我的收藏（登录）：收藏 = 每用户唯一默认列表的增删查
  app.route("/", myFavoritesRoutes(deps.repo));
  app.route("/", voiceRoutes(deps.voice));
  app.route("/", favoritesRoutes(deps.favorites));
  // 设备授权确认（cookie 会话 + editor/admin 角色）——挂在认证中间件之后
  app.route("/", deviceApproveRoutes(deviceStore, deps.auth));
  // 编辑端（本质版）：队列/详情/拒审/发布/嘉宾/采样下载——requireRole(editor|admin) 在 editorRoutes 内部施加
  app.route("/", editorRoutes(deps.editor));
  // 编辑端播放列表（平台策展）——requireRole 在 playlistEditorRoutes 内部施加；封面上传复用 editor storage
  app.route("/", playlistEditorRoutes({ repo: deps.repo, storage: deps.editor.storage }));
  // 统一 TTS（编辑本地合成语音走此端点；requireRole 在 ttsRoutes 内部施加）
  app.route("/", ttsRoutes(deps.tts));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
