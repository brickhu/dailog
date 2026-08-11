import { createMiddleware } from "hono/factory";

export type Role = "user" | "editor" | "admin";
export type AuthEnv = { Variables: { userId: string; role: Role } };

/** 认证最小接口（better-auth 实例满足；单测可注入 fake） */
export interface AuthLike {
  handler(req: Request): Promise<Response>;
  api: {
    getSession(opts: { headers: Headers }): Promise<{ user: { id: string } } | null>;
  };
}

/** 认证中间件（M5）：better-auth 会话校验——cookie 与 Authorization: Bearer 双通道；
 *  注入 getRole（读 profiles.role）时同时设置 c.get("role")，供 requireRole 守卫使用 */
export function createAuthMiddleware(auth: AuthLike, getRole?: (userId: string) => Promise<Role | null>) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", session.user.id);
    c.set("role", getRole ? (await getRole(session.user.id)) ?? "user" : "user");
    await next();
  });
}

/** 角色守卫：requireRole("editor") 放行 editor + admin；requireRole("admin") 仅 admin。
 *  用于 /v1/editor/* 路由（挂载在认证中间件之后，c.get("role") 已注入） */
export function requireRole(role: Role) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const userRole = c.get("role");
    const allowed = role === "admin" ? userRole === "admin" : userRole === role || userRole === "admin";
    if (!allowed) return c.json({ error: "forbidden", detail: "需要编辑权限" }, 403);
    await next();
  });
}
