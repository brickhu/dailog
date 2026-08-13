import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./config/env";
import { createAuthMiddleware, type AuthEnv, type AuthLike } from "./middleware/auth";
import { createCorsMiddleware } from "./middleware/cors";
import { profileRoutes } from "./routes/profile";
import { submissionsRoutes } from "./routes/submissions";
import { notificationsRoutes } from "./routes/notifications";
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
      const data = await deps.voice.storage.get(cover);
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
      const data = await deps.voice.storage.get(audio.audioKey);
      return new Response(new Uint8Array(data), {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=3600", ETag: etag },
      });
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
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
