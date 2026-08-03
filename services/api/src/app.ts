import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./config/env";
import { createAuthMiddleware, type AuthEnv, type AuthLike } from "./middleware/auth";
import { createCorsMiddleware } from "./middleware/cors";
import { importsRoutes } from "./routes/imports";
import { episodesRoutes } from "./routes/episodes";
import { polishRoutes, type PolishDeps } from "./routes/polish";
import { generateRoutes, type GenerateDeps } from "./routes/generate";
import { jobRoutes, type JobDeps } from "./routes/job";
import { voiceRoutes, type VoiceDeps } from "./routes/voice";
import { channelRoutes, type ChannelDeps } from "./routes/channel";
import { favoritesRoutes, type FavoritesRepo } from "./routes/favorites";
import { tokenRoutes } from "./routes/token";
import type { Repos } from "./repo";

export type { AuthLike };
export type AppDeps = {
  env: Env;
  auth: AuthLike; // better-auth 实例（/api/auth/* 处理器 + 认证中间件）
  repo: Repos;
  polish: PolishDeps;
  generate: GenerateDeps;
  job: JobDeps;
  voice: VoiceDeps;
  channel: ChannelDeps; // 频道开通（授权码激活）
  favorites: FavoritesRepo; // 消费端互动（收藏/点赞）
};

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  // 工作台 SPA 跨域（本地 dev + 生产 app.dailogues.com）；OPTIONS 预检在此统一 204。
  // 必须先于其它路由注册（Hono middleware 顺序敏感），否则先注册的路由不经 CORS
  const appOrigins = deps.env.APP_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  app.use("*", createCorsMiddleware(appOrigins));

  app.get("/health", (c) => c.json({ ok: true }));

  // better-auth 会话路由（注册/登录/登出/get-session）：挂在认证中间件之前，免鉴权
  app.on(["POST", "GET"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));

  app.use("/api/*", createAuthMiddleware(deps.auth));

  app.get("/api/me", async (c) => {
    const userId = c.get("userId");
    const activated = await deps.repo.episodes.getChannelActivatedAt(userId);
    return c.json({ userId, channelActive: activated !== null });
  });

  app.route("/api", importsRoutes(deps.repo.imports));
  app.route("/api", episodesRoutes(deps.repo.episodes, (c) => (c as Context<AuthEnv>).get("userId"), deps.voice.storage));
  // polish/generate/job/voice 路由自带 /api 前缀（与各自 test.ts 直接对裸 app 请求 /api/... 一致），故挂载在根路径；
  // 上面的 /api/* 鉴权中间件依然覆盖
  app.route("/", polishRoutes(deps.polish));
  app.route("/", generateRoutes(deps.generate));
  app.route("/", jobRoutes(deps.job, (c) => (c as unknown as { get: (k: string) => string }).get("userId")));
  app.route("/", voiceRoutes(deps.voice));
  app.route("/", channelRoutes(deps.channel));
  app.route("/", favoritesRoutes(deps.favorites));
  app.route("/", tokenRoutes(deps.auth));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
