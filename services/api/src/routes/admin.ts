import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// 管理端点：创建邀请码（管理员专用；生产环境无法直连 DB 时经 HTTP 发码）
// POST /api/admin/invite-codes { code?, expiresDays? } → 非管理员 403 forbidden /
//   非法 code 400 invalid_invite_code / 非法 expiresDays 400 invalid_expires_days /
//   重复 400 duplicate_invite_code / 成功 201 { code, expiresAt }
// 缺省 code 自动生成 dlg-<8hex>，缺省 expiresDays 永不过期；管理员判定 = authUsers.email ∈ ADMIN_EMAILS 白名单

export interface AdminDeps {
  isAdmin(userId: string): Promise<boolean>;
  createInviteCode(userId: string, opts: { code?: string; expiresDays?: number }):
    Promise<{ ok: true; code: string; expiresAt: Date | null } | { error: "duplicate_invite_code" }>;
}

const CODE_RE = /^[A-Za-z0-9_-]{3,64}$/;

export function adminRoutes(deps: AdminDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.post("/v1/admin/invite-codes", async (c) => {
    const userId = c.get("userId") as string;
    if (!(await deps.isAdmin(userId))) return c.json({ error: "forbidden" }, 403);

    const body = await c.req.json().catch(() => null);
    let code: string | undefined;
    if (body?.code !== undefined) {
      if (typeof body.code !== "string" || !CODE_RE.test(body.code.trim())) {
        return c.json({ error: "invalid_invite_code" }, 400);
      }
      code = body.code.trim();
    }
    let expiresDays: number | undefined;
    if (body?.expiresDays !== undefined) {
      if (
        typeof body.expiresDays !== "number" ||
        !Number.isInteger(body.expiresDays) ||
        body.expiresDays < 1 ||
        body.expiresDays > 3650
      ) {
        return c.json({ error: "invalid_expires_days" }, 400);
      }
      expiresDays = body.expiresDays;
    }

    const result = await deps.createInviteCode(userId, { code, expiresDays });
    if ("error" in result) return c.json({ error: result.error }, 400);
    return c.json({ code: result.code, expiresAt: result.expiresAt?.toISOString() ?? null }, 201);
  });
  return app;
}

/** 管理员身份判定：authUsers.email 在 ADMIN_EMAILS 白名单（逗号分隔）内 */
export function createAdminDeps(db: PostgresJsDatabase<typeof schema>, adminEmailsCsv: string): AdminDeps {
  const whitelist = new Set(adminEmailsCsv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  return {
    isAdmin: async (userId) => {
      if (whitelist.size === 0) return false;
      const rows = await db
        .select({ email: schema.authUsers.email })
        .from(schema.authUsers)
        .where(eq(schema.authUsers.id, userId))
        .limit(1);
      return rows.length > 0 && whitelist.has(rows[0].email.toLowerCase());
    },
    createInviteCode: async (userId, { code, expiresDays }) => {
      const expiresAt = expiresDays !== undefined ? new Date(Date.now() + expiresDays * 86400_000) : null;
      // 显式 code 冲突直接报错；随机 code 撞唯一索引（概率极低）重试最多 3 次
      for (let attempt = 0; attempt < 3; attempt++) {
        const finalCode = code ?? `dlg-${randomBytes(4).toString("hex")}`;
        const rows = await db.insert(schema.inviteCodes)
          .values({ code: finalCode, createdBy: userId, source: "admin", expiresAt })
          .onConflictDoNothing({ target: schema.inviteCodes.code })
          .returning({ code: schema.inviteCodes.code, expiresAt: schema.inviteCodes.expiresAt });
        if (rows.length > 0) return { ok: true, code: rows[0].code, expiresAt: rows[0].expiresAt };
        if (code !== undefined) return { error: "duplicate_invite_code" };
      }
      return { error: "duplicate_invite_code" };
    },
  };
}
