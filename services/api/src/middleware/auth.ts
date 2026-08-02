import { createMiddleware } from "hono/factory";
import type { VerifyToken } from "../auth/verify";

export type AuthEnv = { Variables: { userId: string } };

export function createAuthMiddleware(verify: VerifyToken) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const header = c.req.header("Authorization");
    const match = header?.match(/^Bearer\s+(.+)$/i); // RFC 6750：scheme 大小写不敏感
    if (!match) return c.json({ error: "unauthorized" }, 401);
    let sub: string;
    try {
      ({ sub } = await verify(match[1]));
    } catch {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("userId", sub);
    await next();
  });
}
