import { Hono } from "hono";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// 频道开通（授权码激活）：注册完全开放，但生成/发布需先开通频道
// POST /api/me/channel/activate { inviteCode } → 校验授权码（未用未过期）→
//   标记 usedBy/usedAt + profiles.channel_activated_at → { ok: true } / 400 invalid_invite_code

export interface ChannelDeps {
  activateChannel(userId: string, inviteCode: string): Promise<{ ok: true } | { error: string }>;
}

export function channelRoutes(deps: ChannelDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.post("/v1/me/channel/activate", async (c) => {
    const body = await c.req.json().catch(() => null);
    const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
    if (!inviteCode) return c.json({ error: "invalid_invite_code" }, 400);
    const result = await deps.activateChannel(c.get("userId") as string, inviteCode);
    if ("error" in result) return c.json({ error: result.error }, 400);
    return c.json(result);
  });
  return app;
}

/** 授权码校验 + 频道开通（事务内：标记码 + 开通频道） */
export function createActivateChannel(db: PostgresJsDatabase<typeof schema>): ChannelDeps["activateChannel"] {
  return async (userId, inviteCode) => {
    const rows = await db
      .select({ id: schema.inviteCodes.id })
      .from(schema.inviteCodes)
      .where(
        and(
          eq(schema.inviteCodes.code, inviteCode),
          isNull(schema.inviteCodes.usedBy),
          or(isNull(schema.inviteCodes.expiresAt), gt(schema.inviteCodes.expiresAt, new Date())),
        ),
      )
      .limit(1);
    if (rows.length === 0) return { error: "invalid_invite_code" };
    await db.transaction(async (tx) => {
      await tx.update(schema.inviteCodes)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(eq(schema.inviteCodes.id, rows[0].id));
      await tx.update(schema.profiles)
        .set({ channelActivatedAt: new Date() })
        .where(eq(schema.profiles.id, userId));
    });
    return { ok: true };
  };
}
