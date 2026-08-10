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
  storage: { put(key: string, data: Uint8Array): Promise<void> };
  createInviteCode(userId: string, opts: { code?: string; expiresDays?: number }):
    Promise<{ ok: true; code: string; expiresAt: Date | null } | { error: "duplicate_invite_code" }>;
  // ---- 嘉宾音频采样（guests 表按平台 × 语种；生成管线注入 TTS） ----
  upsertGuestVoiceSample(row: {
    guestId: string; language: string; audioKey: string;
    referenceId?: string | null; transcript?: string | null;
  }): Promise<void>;
  listGuestVoiceSamples(): Promise<{
    id: string; guestId: string; guestName: string; language: string;
    audioKey: string; referenceId: string | null; transcript: string | null;
  }[]>;
  listGuests(): Promise<{ id: string; name: string }[]>;
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

  /** 嘉宾采样列表（管理用；含 guests 展示名） */
  app.get("/v1/admin/guest-voices", async (c) => {
    const userId = c.get("userId") as string;
    if (!(await deps.isAdmin(userId))) return c.json({ error: "forbidden" }, 403);
    return c.json(await deps.listGuestVoiceSamples());
  });

  /** 嘉宾采样录入/更新：multipart { file, guestId, language?, referenceId?, transcript? } */
  app.put("/v1/admin/guest-voices", async (c) => {
    const userId = c.get("userId") as string;
    if (!(await deps.isAdmin(userId))) return c.json({ error: "forbidden" }, 403);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return c.json({ error: "file_required" }, 400);
    const guestId = typeof form?.get("guestId") === "string" ? (form.get("guestId") as string).trim() : "";
    if (!guestId) return c.json({ error: "guest_required" }, 400);
    // 嘉宾必须存在（guests 表白名单）
    const guests = await deps.listGuests();
    if (!guests.some((g) => g.id === guestId)) return c.json({ error: "unknown_guest" }, 400);
    const language = typeof form?.get("language") === "string" && /^[a-z]{2,3}$/i.test(form.get("language") as string)
      ? (form.get("language") as string).toLowerCase()
      : "zh";
    const referenceId = typeof form?.get("referenceId") === "string" && (form.get("referenceId") as string).trim()
      ? (form.get("referenceId") as string).trim().slice(0, 120)
      : null;
    const transcript = typeof form?.get("transcript") === "string" && (form.get("transcript") as string).trim()
      ? (form.get("transcript") as string).trim().slice(0, 1000)
      : null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    // storage key 规划：guest-voices/{guestId}/{language}.mp3（保留原始扩展名）
    const ext = (file.name.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `guest-voices/${guestId}/${language}.${ext === "" ? "mp3" : ext}`;
    await deps.storage.put(key, bytes);
    await deps.upsertGuestVoiceSample({ guestId, language, audioKey: key, referenceId, transcript });
    return c.json({ ok: true, guestId, language, audioKey: key });
  });

  return app;
}

/** 管理员身份判定：authUsers.email 在 ADMIN_EMAILS 白名单（逗号分隔）内 */
export function createAdminDeps(db: PostgresJsDatabase<typeof schema>, adminEmailsCsv: string): AdminDeps {
  const whitelist = new Set(adminEmailsCsv.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  return {
    // storage 由调用方（index.ts）注入
    storage: { put: async () => {} },
    isAdmin: async (userId) => {
      if (whitelist.size === 0) return false;
      const rows = await db
        .select({ email: schema.authUsers.email })
        .from(schema.authUsers)
        .where(eq(schema.authUsers.id, userId))
        .limit(1);
      return rows.length > 0 && whitelist.has(rows[0].email.toLowerCase());
    },
    upsertGuestVoiceSample: async (row) => {
      await db.insert(schema.guestVoiceSamples).values({
        guestId: row.guestId,
        language: row.language,
        audioKey: row.audioKey,
        referenceId: row.referenceId ?? null,
        transcript: row.transcript ?? null,
      }).onConflictDoUpdate({
        target: [schema.guestVoiceSamples.guestId, schema.guestVoiceSamples.language],
        set: {
          audioKey: row.audioKey,
          referenceId: row.referenceId ?? null,
          transcript: row.transcript ?? null,
        },
      });
    },
    listGuestVoiceSamples: async () => {
      return db
        .select({
          id: schema.guestVoiceSamples.id,
          guestId: schema.guestVoiceSamples.guestId,
          guestName: schema.guests.name,
          language: schema.guestVoiceSamples.language,
          audioKey: schema.guestVoiceSamples.audioKey,
          referenceId: schema.guestVoiceSamples.referenceId,
          transcript: schema.guestVoiceSamples.transcript,
        })
        .from(schema.guestVoiceSamples)
        .innerJoin(schema.guests, eq(schema.guests.id, schema.guestVoiceSamples.guestId))
        .orderBy(schema.guests.platform);
    },
    listGuests: async () => {
      const rows = await db
        .select({ id: schema.guests.id, name: schema.guests.name })
        .from(schema.guests)
        .orderBy(schema.guests.platform);
      return rows;
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
