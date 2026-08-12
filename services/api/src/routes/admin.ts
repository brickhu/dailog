import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";

// 管理端点：嘉宾音频采样（guests 表按平台 × 语种；生成管线注入 TTS）
// POST /api/admin/guest-voices、PUT /api/admin/guest-voices → 非管理员 403 forbidden
// 管理员判定 = authUsers.email ∈ ADMIN_EMAILS 白名单

export interface AdminDeps {
  isAdmin(userId: string): Promise<boolean>;
  storage: { put(key: string, data: Uint8Array): Promise<void> };
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

export function adminRoutes(deps: AdminDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

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
  };
}
