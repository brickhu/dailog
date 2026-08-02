import { createMiddleware } from "hono/factory";
import type { VerifyToken } from "../auth/verify";

export type AuthEnv = { Variables: { userId: string } };

export function createAuthMiddleware(verify: VerifyToken) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) return c.json({ error: "unauthorized" }, 401);
    try {
      const { sub } = await verify(token);
      c.set("userId", sub);
      await next();
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
  });
}
