import { Hono } from "hono";
import type { Env } from "./config/env";
import type { VerifyToken } from "./auth/verify";
import { createAuthMiddleware, type AuthEnv } from "./middleware/auth";
import { importsRoutes, type ImportsRepo } from "./routes/imports";

export type AppDeps = { env: Env; verifyToken: VerifyToken; importsRepo: ImportsRepo };

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/api/*", createAuthMiddleware(deps.verifyToken));

  app.get("/api/me", (c) => c.json({ userId: c.get("userId") }));

  app.route("/api", importsRoutes(deps.importsRepo));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
