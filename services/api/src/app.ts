import { Hono } from "hono";
import type { Context } from "hono";
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

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const deviceStore = deps.deviceStore ?? createDeviceStore();

  // 跨域（本地 dev + 生产 app.dailog.fm）；OPTIONS 预检在此统一 204。
  // 必须先于其它路由注册（Hono middleware 顺序敏感），否则先注册的路由不经 CORS
  const appOrigins = deps.env.APP_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use("*", createCorsMiddleware(appOrigins));

  app.get("/health", (c) => c.json({ ok: true }));

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
  app.get("/v1/public/episodes/:id/cover", async (c) => {
    const cover = await deps.repo.episodes.getPublicCoverKey(c.req.param("id"));
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
  app.get("/v1/public/episodes/:id/audio", async (c) => {
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
      const baseHeaders = {
        "Content-Type": audioContentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=604800",
        ETag: etag,
      };
      // Range 分片（浏览器流式播放/seek 依赖 206）：storage 层有磁盘缓存——
      // 命中本地直读（毫秒）；未命中小分片 R2 直读快速响应 + 后台落盘；无 range 全量落盘后返回
      const range = c.req.header("range");
      const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : start + 1024 * 1024;
        const r = await deps.voice.storage.get(audio.audioKey, { start, end });
        const total = r.total;
        if (!Number.isFinite(start) || start > end || start >= total) {
          return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
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
      // 无 Range：全量（storage 磁盘缓存层落盘后本地直读）
      const full = await deps.voice.storage.get(audio.audioKey);
      return new Response(full.data as unknown as BodyInit, {
        headers: { ...baseHeaders, "Content-Length": String(full.total) },
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  // 播放/完播上报 + 统计读取（公开播放器；仅已发布公开节目）。
  // 鉴权策略：免登录（未登录听众也计入，保证统计口径）；防刷 = 前端 session 级去重
  // + 服务端同 IP 同节目 5 分钟窗口限频（内存表；服务重启清空可接受，防 curl 连刷）
  const statCooldown = new Map<string, number>();
  const STAT_WINDOW_MS = 5 * 60 * 1000;
  const statKey = (ip: string, id: string, type: string) => `${ip}:${id}:${type}`;
  app.post("/v1/public/episodes/:id/stats/:type", async (c) => {
    const type = c.req.param("type");
    if (type !== "play" && type !== "completion") return c.json({ error: "invalid_type" }, 400);
    const id = c.req.param("id");
    const exists = await deps.repo.episodes.getPublicAudioKey(id);
    if (!exists) return c.json({ error: "not_found" }, 404);
    // 限频：同 IP 同 episode 同事件 5 分钟内只计一次（CF 代理头优先；本地无头 → 空串）
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const key = statKey(ip, id, type);
    const now = Date.now();
    const last = statCooldown.get(key) ?? 0;
    if (now - last < STAT_WINDOW_MS) return c.json({ ok: true }); // 窗口内重复：静默忽略不计数
    statCooldown.set(key, now);
    await deps.repo.episodes.recordStat(id, type);
    return c.json({ ok: true });
  });
  app.get("/v1/public/episodes/:id/stats", async (c) => {
    const exists = await deps.repo.episodes.getPublicAudioKey(c.req.param("id"));
    if (!exists) return c.json({ error: "not_found" }, 404);
    return c.json(await deps.repo.episodes.getStats(c.req.param("id")));
  });

  // 推荐队列（首页播放器/抖音流）：热度分排序；lang 优先、exclude 排除已播
  app.get("/v1/public/episodes/recommended", async (c) => {
    const lang = typeof c.req.query("lang") === "string" && /^[a-z]{2,3}$/i.test(c.req.query("lang") ?? "")
      ? (c.req.query("lang") as string).toLowerCase()
      : undefined;
    const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 50);
    const exclude = (c.req.query("exclude") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 100);
    return c.json(await deps.repo.episodes.listRecommended({ lang, limit, exclude: exclude.length > 0 ? exclude : undefined }));
  });

  // 站点头部数据（首页宣传语）——公开
  app.get("/v1/public/stats", async (c) => {
    return c.json(await deps.repo.episodes.getSiteStats());
  });
  // 热门主播（个人主页入口）——公开
  app.get("/v1/public/hosts", async (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 8) || 8, 20);
    return c.json(await deps.repo.episodes.listTopHosts(limit));
  });
  // 常驻 AI 嘉宾（品牌声线宿主）——公开
  app.get("/v1/public/guests", async (c) => {
    return c.json(await deps.repo.guests.list());
  });
  // 嘉宾详情 + 参与的节目（公开详情页 /guest/<id>）——不存在 404
  app.get("/v1/public/guests/:id", async (c) => {
    const id = c.req.param("id");
    const guest = await deps.repo.guests.getById(id);
    if (!guest) return c.json({ error: "not_found" }, 404);
    const episodes = await deps.repo.episodes.listByGuest(id);
    return c.json({ guest, episodes });
  });

  app.use("/v1/*", createAuthMiddleware(deps.auth, async (userId) => (await deps.repo.episodes.getRole?.(userId)) ?? null));

  app.get("/v1/me", async (c) => {
    const userId = c.get("userId");
    const sample = await deps.repo.episodes.getVoiceSample(userId);
    const role = (await deps.repo.episodes.getRole?.(userId)) ?? "user";
    return c.json({ userId, role, channelActive: true, hasVoiceSample: sample !== null });
  });

  app.route("/", submissionsRoutes(deps.repo));
  app.route("/", profileRoutes({ repo: deps.repo }));
  app.route("/", notificationsRoutes(deps.repo));
  app.route("/", meEpisodesRoutes(deps.repo));
  app.route("/", voiceRoutes(deps.voice));
  app.route("/", favoritesRoutes(deps.favorites));
  // 设备授权确认（cookie 会话 + editor/admin 角色）——挂在认证中间件之后
  app.route("/", deviceApproveRoutes(deviceStore, deps.auth));
  // 编辑端（本质版）：队列/详情/拒审/发布/嘉宾/采样下载——requireRole(editor|admin) 在 editorRoutes 内部施加
  app.route("/", editorRoutes(deps.editor));
  // 统一 TTS（编辑本地合成语音走此端点；requireRole 在 ttsRoutes 内部施加）
  app.route("/", ttsRoutes(deps.tts));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
