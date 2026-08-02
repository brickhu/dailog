import { Hono } from "hono";
import type { Env } from "./config/env";
import type { VerifyToken } from "./auth/verify";
import { createAuthMiddleware, type AuthEnv } from "./middleware/auth";

export type AppDeps = { env: Env; verifyToken: VerifyToken };

export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("/api/*", createAuthMiddleware(deps.verifyToken));

  app.get("/api/me", (c) => c.json({ userId: c.get("userId") }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
