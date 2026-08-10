// 账号/频道管理端点：
//  GET /api/me/profile    → 账号（email/name/GitHub 状态）+ 频道（username/displayName/bio）档案
//  PATCH /api/me/profile  { nickname } → 账号昵称（user.name 列）
//  PATCH /api/me/channel  { username?, displayName?, bio? } → 频道设置（slug 格式校验 + 唯一）
// 账号管理（改密码/GitHub 登录）走 better-auth 官方端点 /api/auth/*（change-password / sign-in/social）。
// 划分：账号 = user 表（邮箱/密码/昵称），频道 = profiles 表（slug/频道名/简介）——site /account 分区块展示。

import { Hono } from "hono";
import type { Repos } from "../repo";

export interface ProfileDeps {
  repo: Repos;
}

const USERNAME_RE = /^[a-z0-9-]{3,30}$/;

export function profileRoutes(deps: ProfileDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.get("/v1/me/profile", async (c) => {
    const userId = c.get("userId") as string;
    const profile = await deps.repo.episodes.getProfile(userId);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json(profile);
  });

  /** 账号昵称（≤30 字，去空白）——接口字段 nickname（DB 列 user.name 为 better-auth 标准字段，内部映射） */
  app.patch("/v1/me/profile", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { nickname?: unknown } | null;
    const nickname = typeof body?.nickname === "string" ? body.nickname.trim() : "";
    if (!nickname || nickname.length > 30) return c.json({ error: "invalid_name" }, 400);
    await deps.repo.episodes.updateUserNickname(userId, nickname);
    return c.json({ ok: true, nickname });
  });

  /** slug 占用检测（输入时实时校验；排除自己；保存时后端仍兜底 409） */
  app.get("/v1/me/channel/check", async (c) => {
    const userId = c.get("userId") as string;
    const username = (c.req.query("username") ?? "").trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return c.json({ error: "invalid_username" }, 400);
    const taken = await deps.repo.episodes.isUsernameTaken(userId, username);
    return c.json({ available: !taken });
  });

  /** 频道设置：slug/频道名/简介（至少一项；slug 小写字母数字连字符） */
  app.patch("/v1/me/channel", async (c) => {
    const userId = c.get("userId") as string;
    const body = (await c.req.json().catch(() => null)) as { username?: unknown; displayName?: unknown; bio?: unknown } | null;
    if (!body) return c.json({ error: "invalid_input" }, 400);

    const row: { username?: string; displayName?: string; bio?: string | null } = {};
    if (body.username !== undefined) {
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      if (!USERNAME_RE.test(username)) {
        return c.json({ error: "invalid_username", detail: "频道地址仅限 3-30 位小写字母、数字、连字符" }, 400);
      }
      row.username = username;
    }
    if (body.displayName !== undefined) {
      const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (!displayName || displayName.length > 30) return c.json({ error: "invalid_display_name" }, 400);
      row.displayName = displayName;
    }
    if (body.bio !== undefined) {
      const bio = typeof body.bio === "string" ? body.bio.trim() : null;
      if (bio !== null && bio.length > 200) return c.json({ error: "invalid_bio" }, 400);
      row.bio = bio;
    }
    if (Object.keys(row).length === 0) return c.json({ error: "invalid_input" }, 400);

    const result = await deps.repo.episodes.updateChannel(userId, row);
    if ("error" in result) return c.json({ error: "username_taken", detail: "该频道地址已被占用" }, 409);
    return c.json({ ok: true });
  });

  return app;
}
