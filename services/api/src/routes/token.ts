import { Hono } from "hono";
import type { AuthLike } from "../middleware/auth";

// GET /api/auth/token：cookie 会话 → 返回 session token。
// 用途：SPA 拿 token 注入扩展（扩展上下文带不了 cookie，需 Bearer）；两站共用。
export function tokenRoutes(auth: AuthLike) {
  const app = new Hono();
  app.get("/v1/auth/token", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    // better-auth session 对象含 token 字段（cookie 会话下同源）
    const token = (session as unknown as { session?: { token?: string } }).session?.token;
    if (!token) return c.json({ error: "no_token" }, 404);
    return c.json({ token });
  });
  return app;
}
