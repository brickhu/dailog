import { createMiddleware } from "hono/factory";

export type AuthEnv = { Variables: { userId: string } };

/** 认证最小接口（better-auth 实例满足；单测可注入 fake） */
export interface AuthLike {
  handler(req: Request): Promise<Response>;
  api: {
    getSession(opts: { headers: Headers }): Promise<{ user: { id: string } } | null>;
  };
}

/** 认证中间件（M5）：better-auth 会话校验——cookie 与 Authorization: Bearer 双通道 */
export function createAuthMiddleware(auth: AuthLike) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", session.user.id);
    await next();
  });
}
