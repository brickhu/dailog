import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "./config/env";
import type { VerifyToken } from "./auth/verify";
import { createAuthMiddleware, type AuthEnv } from "./middleware/auth";
import { importsRoutes } from "./routes/imports";
import { episodesRoutes } from "./routes/episodes";
import { polishRoutes, type PolishDeps } from "./routes/polish";
import { generateRoutes, type GenerateDeps } from "./routes/generate";
import { jobRoutes, type JobDeps } from "./routes/job";
import type { Repos } from "./repo";

export type AppDeps = {
  env: Env;
  verifyToken: VerifyToken;
  repo: Repos;
  polish: PolishDeps;
  generate: GenerateDeps;
  job: JobDeps;
};

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/api/*", createAuthMiddleware(deps.verifyToken));

  app.get("/api/me", (c) => c.json({ userId: c.get("userId") }));

  app.route("/api", importsRoutes(deps.repo.imports));
  app.route("/api", episodesRoutes(deps.repo.episodes, (c) => (c as Context<AuthEnv>).get("userId")));
  // polish/generate/job 路由自带 /api 前缀（与各自 test.ts 直接对裸 app 请求 /api/... 一致），故挂载在根路径；
  // 上面的 /api/* 鉴权中间件依然覆盖
  app.route("/", polishRoutes(deps.polish));
  app.route("/", generateRoutes(deps.generate));
  app.route("/", jobRoutes(deps.job));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
