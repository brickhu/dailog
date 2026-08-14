// 账号/主持人档案管理端点：
//  GET /v1/me/profile  → 账号（email/nickname/GitHub 状态）+ 主持人档案（displayName/bio/gender/profession/age/nationality/socialLinks）
//  PATCH /v1/me/profile  { nickname? } → 账号昵称（user.name = @slug；注册时应用层唯一）
//                      { displayName?, bio?, gender?, profession?, age?, nationality?, socialLinks? } → 主持人档案
// 账号管理（改密码/GitHub 登录）走 better-auth 官方端点 /api/auth/*（change-password / sign-in/social）。
// 划分：账号 = user 表（邮箱/密码/昵称=@slug），主持人档案 = profiles 表（displayName/画像/社交链接）。
// 频道概念已废弃（无 username slug）；@主页 = user.name。

import { Hono } from "hono";
import type { Repos } from "../repo";

export interface ProfileDeps {
  repo: Repos;
}

export function profileRoutes(deps: ProfileDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.get("/v1/me/profile", async (c) => {
    const userId = c.get("userId") as string;
    const profile = await deps.repo.episodes.getProfile(userId);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json(profile);
  });

  /** 账号昵称（≤30 字，去空白）——接口字段 nickname（DB 列 user.name = @slug；注册时应用层唯一） */
  app.patch("/v1/me/profile", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "invalid_input" }, 400);

    // 账号昵称（@slug）
    if (body.nickname !== undefined) {
      const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
      if (!nickname || nickname.length > 30) return c.json({ error: "invalid_name" }, 400);
      await deps.repo.episodes.updateUserNickname(userId, nickname);
    }

    // 主持人档案（displayName/bio/gender/profession/age/nationality/socialLinks）
    const row: {
      displayName?: string;
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
    const displayName = check(body.displayName, 30);
    if (displayName !== undefined) {
      if (!displayName) return c.json({ error: "invalid_display_name" }, 400);
      row.displayName = displayName;
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
  });

  return app;
}
