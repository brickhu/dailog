// 账号 / 身份档案端点（三层分离：账号 user · 身份 profiles · 采样 voice_samples）：
//  GET /v1/me/profile  → 账号（email/username/emailVerified）+ 身份档案
//                        （name/avatar/bio/gender/profession/age/nationality/socialLinks/url）
//  PATCH /v1/me/profile  { username? } → 用户名（user.name = @slug；**仅英文数字**、唯一、主页 /@xxx）
//                      { name?, bio?, gender?, profession?, age?, nationality?, socialLinks? } → 身份档案
// 账号管理（改密码/GitHub 登录）走 better-auth 官方端点 /api/auth/*（change-password / sign-in/social）。
// **节目中的称呼（callName）不在这里**——它随声音采样走（voice_samples.call_name，按语言区，
// 见 /v1/me/voice-sample 的 PATCH）。

import { createRoute, OpenAPIHono, z, type RouteHandler } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Repos } from "../repo";

export interface ProfileDeps {
  repo: Repos;
}

export function profileRoutes(deps: ProfileDeps) {
  const app = new OpenAPIHono<{ Variables: { userId: string } }>();
  const Err = z.object({ error: z.string() });

  const r1 = createRoute({
    method: "get",
    path: "/v1/me/profile",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/profile" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r1, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const profile = await deps.repo.episodes.getProfile(userId);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json(profile);
  }) as unknown as RouteHandler<typeof r1, { Variables: { userId: string } }>);

  /** 导航栏聚合：一次请求替代 get-session + profile + 未读数三连（减少整页加载请求数） */
  const r2 = createRoute({
    method: "get",
    path: "/v1/me/overview",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/overview" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r2, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const [profile, unread] = await Promise.all([
      deps.repo.episodes.getProfile(userId).catch(() => null),
      deps.repo.notifications.unreadCount(userId).catch(() => 0),
    ]);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json({
      user: { id: userId, name: profile.username ?? null, email: profile.email ?? null, avatar: profile.avatar ?? null },
      username: profile.username ?? null, // user.name = @slug
      unreadCount: unread,
    });
  }) as unknown as RouteHandler<typeof r2, { Variables: { userId: string } }>);

  /** 用户名（user.name = @slug）：**仅英文数字**、3–30 位、唯一（大小写不敏感）、主页 /@xxx */
  const r3 = createRoute({
    method: "patch",
    path: "/v1/me/profile",
    
    responses: {
      200: { content: { "application/json": { schema: z.any() } }, description: "/v1/me/profile" },
      404: { content: { "application/json": { schema: Err } }, description: "不存在" },
    },
  });
  app.openapi(r3, (async (c: Context) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "invalid_input" }, 400);

    // 用户名（@slug）：仅英文数字 + 唯一（大小写不敏感）
    if (body.username !== undefined) {
      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!/^[A-Za-z0-9]{3,30}$/.test(username)) {
        return c.json({ error: "invalid_username", detail: "用户名仅支持 3–30 位英文或数字" }, 400);
      }
      if (await deps.repo.episodes.usernameTaken(username, userId)) {
        return c.json({ error: "username_taken", detail: "该用户名已被占用" }, 409);
      }
      await deps.repo.episodes.updateUserNickname(userId, username);
    }

    // 身份档案（name/bio/gender/profession/age/nationality/socialLinks）
    const row: {
      name?: string;
      bio?: string | null;
      gender?: string | null;
      profession?: string | null;
      age?: string | null;
      nationality?: string | null;
      socialLinks?: Record<string, string> | null;
    } = {};
    // 空/超长 → 400（不静默截断）；短字段截断兜底
    const check = (v: unknown, max: number): string | null | undefined => {
      if (v === undefined) return undefined;
      if (typeof v !== "string") return null;
      const t = v.trim();
      return t.length > max ? null : t || null;
    };
    const name = check(body.name, 30);
    if (name !== undefined) {
      if (!name) return c.json({ error: "invalid_name" }, 400);
      row.name = name;
    }
    const bio = check(body.bio, 200);
    if (bio !== undefined && !bio) return c.json({ error: "invalid_bio" }, 400);
    if (bio !== undefined) row.bio = bio;
    const gender = check(body.gender, 10);
    if (gender !== undefined && !gender) return c.json({ error: "invalid_gender" }, 400);
    if (gender !== undefined) row.gender = gender;
    const profession = check(body.profession, 30);
    if (profession !== undefined && !profession) return c.json({ error: "invalid_profession" }, 400);
    if (profession !== undefined) row.profession = profession;
    const age = check(body.age, 10);
    if (age !== undefined && !age) return c.json({ error: "invalid_age" }, 400);
    if (age !== undefined) row.age = age;
    const nationality = check(body.nationality, 20);
    if (nationality !== undefined && !nationality) return c.json({ error: "invalid_nationality" }, 400);
    if (nationality !== undefined) row.nationality = nationality;
    if (body.socialLinks !== undefined) {
      const raw = body.socialLinks;
      if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
        return c.json({ error: "invalid_social_links" }, 400);
      }
      const links: Record<string, string> = {};
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          const val = typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : "";
          if (val) links[k.slice(0, 20)] = val;
        }
      }
      row.socialLinks = Object.keys(links).length > 0 ? links : null;
    }
    if (Object.keys(row).length > 0) {
      await deps.repo.episodes.updateChannel(userId, row);
    }

    return c.json({ ok: true });
  }) as unknown as RouteHandler<typeof r3, { Variables: { userId: string } }>);

  return app;
}
