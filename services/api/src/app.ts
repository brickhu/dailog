import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./config/env";
import { createAuthMiddleware, type AuthEnv, type AuthLike } from "./middleware/auth";
import { createCorsMiddleware } from "./middleware/cors";
import { episodesRoutes, type EpisodesDeps } from "./routes/episodes";
import { importRoutes, type ImportDeps } from "./routes/import";
import { polishesRoutes, type PolishesDeps } from "./routes/polishes";
import { transcriptsRoutes, type TranscriptsDeps } from "./routes/transcripts";
import { profileRoutes } from "./routes/profile";
import { importerRoutes } from "./routes/importer";
import { authExtRoutes } from "./routes/auth-ext";
import { jobRoutes, type JobDeps } from "./routes/job";
import { voiceRoutes, type VoiceDeps } from "./routes/voice";
import { channelRoutes, type ChannelDeps } from "./routes/channel";
import { favoritesRoutes, type FavoritesRepo } from "./routes/favorites";
import { tokenRoutes } from "./routes/token";
import { adminRoutes, type AdminDeps } from "./routes/admin";
import type { Repos } from "./repo";

export type { AuthLike };
export type AppDeps = {
  env: Env;
  auth: AuthLike; // better-auth 实例（/api/auth/* 处理器 + 认证中间件）
  repo: Repos;
  importDeps: ImportDeps;
  polishesDeps: PolishesDeps;
  transcriptsDeps: TranscriptsDeps;
  episodesDeps: EpisodesDeps;
  job: JobDeps;
  voice: VoiceDeps;
  channel: ChannelDeps; // 频道开通（授权码激活）
  favorites: FavoritesRepo; // 消费端互动（收藏/点赞）
  admin: AdminDeps; // 管理端点（ADMIN_EMAILS 白名单判定）
  /** importer 服务地址（测试注入用；缺省读 IMPORTER_URL env） */
  shareCollectUrl?: () => string | null;
  /** auth-ext 统一登录/注册端点依赖（缺省由 app 内 db + auth 组装） */
  authExt?: { env: unknown; db: unknown; auth: unknown };
};

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // 工作台 SPA 跨域（本地 dev + 生产 app.dailog.fm）；OPTIONS 预检在此统一 204。
  // 必须先于其它路由注册（Hono middleware 顺序敏感），否则先注册的路由不经 CORS
  const appOrigins = deps.env.APP_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use("*", createCorsMiddleware(appOrigins));

  app.get("/health", (c) => c.json({ ok: true }));

  // 自定义 /api/auth/token（cookie 会话 → session token，供扩展注入）必须先于
  // better-auth 全捕获注册：下面 /api/auth/* 通配会吞掉一切子路径（未知子路由返回空 404），
  // 后注册的同路径路由永远轮不到。其余 /api/auth/* 仍全部交 better-auth 处理。
  app.route("/", tokenRoutes(deps.auth));

  // 统一登录/注册（老用户密码登录 / 新用户验证码注册）——必须先于 better-auth
  // 的 /api/auth/* 全捕获注册（Hono 先注册先匹配，否则被吞返回 404）
  app.route("/", authExtRoutes(deps.authExt as never));

  // better-auth 会话路由（注册/登录/登出/get-session）：挂在认证中间件之前，免鉴权
  app.on(["POST", "GET"], "/v1/auth/*", (c) => deps.auth.handler(c.req.raw));

  // 主站公开端点（免鉴权）：仅已发布公开节目可读——必须在鉴权中间件之前注册
  app.get("/v1/public/episodes/:id/audio", async (c) => {
    const audio = await deps.repo.episodes.getPublicAudioKey(c.req.param("id"));
    if (!audio) return c.json({ error: "not_found" }, 404);
    // ETag 按音轨创建时间：重试重新生成后内容变化 → 浏览器重新拉取；未变 → 304 省流量
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

  app.use("/v1/*", createAuthMiddleware(deps.auth));

  app.get("/v1/me", async (c) => {
    const userId = c.get("userId");
    const activated = await deps.repo.episodes.getChannelActivatedAt(userId);
    const sample = await deps.repo.episodes.getVoiceSample(userId);
    return c.json({ userId, channelActive: activated !== null, hasVoiceSample: sample !== null });
  });

  // import/polishes/transcripts 路由内部自带 /api 前缀（挂根）；importer 路由无前缀（挂 /api）
  app.route("/", importRoutes(deps.importDeps));
  app.route("/", polishesRoutes(deps.polishesDeps));
  app.route("/", transcriptsRoutes(deps.transcriptsDeps));
  app.route("/", profileRoutes({ repo: deps.repo }));
  app.route("/v1", importerRoutes(() => deps.shareCollectUrl?.() ?? process.env.IMPORTER_URL ?? null));
  app.route("/v1", episodesRoutes(deps.episodesDeps, (c) => (c as Context<AuthEnv>).get("userId"), deps.voice.storage));
  // polish/generate/job/voice 路由自带 /api 前缀（与各自 test.ts 直接对裸 app 请求 /api/... 一致），故挂载在根路径；
  // 上面的 /api/* 鉴权中间件依然覆盖
  app.route("/", jobRoutes(deps.job, (c) => (c as unknown as { get: (k: string) => string }).get("userId")));
  app.route("/", voiceRoutes(deps.voice));
  app.route("/", channelRoutes(deps.channel));
  app.route("/", favoritesRoutes(deps.favorites));
  app.route("/", adminRoutes(deps.admin));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
