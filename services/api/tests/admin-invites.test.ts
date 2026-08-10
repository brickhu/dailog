import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";
import { adminRoutes, createAdminDeps } from "../src/routes/admin";

// 管理端点（管理员创建邀请码）：ADMIN_EMAILS 白名单判定 + 插入 invite_codes
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeAuth(session: { user: { id: string } } | null = { user: { id: "user-1" } }) {
  return {
    handler: async () => new Response(),
    api: { getSession: async () => session },
  };
}

function fakeRepo(): AppDeps["repo"] {
  return {
    snapshots: {
      getByUrl: async () => null,
      getById: async () => null,
      create: async () => ({ id: "snap-1" }),
      updateContent: async () => {},
      updateQuality: async () => {},
      markUnreachable: async () => {},
      markParseFailed: async () => {},
    },
    polishes: {
      findByUserSnapshot: async () => null,
      updateHostName: async () => {},
      create: async () => ({ id: "polish-1" }),
      getOwned: async () => null,
      getPolishDetail: async () => null,
      listByUser: async () => [],
    },
    transcripts: {
      create: async () => ({ id: "transcript-1" }),
      listByPolish: async () => [],
      getOwned: async () => null,
      updateSegments: async () => {},
    },
    episodes: {
      create: async () => ({ id: "ep-1" }),
      listByUser: async () => [],
      getOwned: async () => null,
      getEpisodeAudio: async () => null,
      getEpisodeScript: async () => null,
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      getVoiceSample: async () => null,
      saveVoiceSample: async () => {},
      getChannelActivatedAt: async () => null,
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      isUsernameTaken: async () => false,
    },
    jobs: {
      getQuotaInfo: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      getOwnedEpisode: async () => ({ id: "ep-1" }),
      listRecoverableJobs: async () => [],
      markJobProgress: async () => {},
      markJobDone: async () => {},
      updateEpisodeAudio: async () => {},
      markJobFailed: async () => {},
    },
  };
}

function fakeImportDeps(): AppDeps["importDeps"] {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async () => ({ id: "snap-1" }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
  };
}
function fakePolishesDeps(): AppDeps["polishesDeps"] {
  return {
    getChannelActivatedAt: async () => new Date(),
    findPolishByUserSnapshot: async () => null,
    updateHostName: async () => {},
    createPolish: async () => ({ id: "polish-1" }),
    getPolishDetail: async () => null,
      listByUser: async () => [],
  };
}
function fakeTranscriptsDeps(): AppDeps["transcriptsDeps"] {
  return {
    getDialogueForPolish: async () => null,
    getTranscriptCount: async () => 0,
    getPolishLimit: async () => 5,
    createTranscript: async () => ({ id: "transcript-1" }),
    getOwnedTranscript: async () => null,
    updateTranscriptSegments: async () => {},
    llm: { complete: async () => "", stream: async () => "" },
  };
}
function fakeEpisodesDeps(): AppDeps["episodesDeps"] {
  return {
    listByUser: async () => [],
    getOwned: async () => null,
    getEpisodeAudio: async () => null,
    getOwnedTranscript: async () => null,
    createEpisode: async () => ({ id: "ep-1" }),
    safetyCheck: async () => ({ pass: true }),
    getChannelActive: async () => true,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
    setPublished: async () => {},
    getChannelActivatedAt: async () => new Date(),
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
    getVoiceSample: async () => null,
    saveVoiceSample: async () => {},
  };
}

function fakeJob(): AppDeps["job"] {
  return {
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestJob: async () => null,
  };
}

function fakeVoice(): AppDeps["voice"] {
  return {
    saveVoiceSample: async () => {},
    storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
  };
}

function fakeAdmin(overrides: Partial<AppDeps["admin"]> = {}): AppDeps["admin"] {
  return {
    isAdmin: async () => true,
    createInviteCode: async (userId, opts) => ({
      ok: true,
      code: opts.code ?? "dlg-auto1234",
      expiresAt: opts.expiresDays !== undefined ? new Date(Date.now() + opts.expiresDays * 86400_000) : null,
    }),
    ...overrides,
  };
}

function baseEnv(extra: Record<string, string> = {}) {
  return {
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://dailogues:dailogues@localhost:5432/dailogues",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    PORT: 8787,
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    DEEPSEEK_MODEL: "deepseek-chat",
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs" as const,
    STORAGE_DIR: "./data",
    ASSETS_DIR: "assets/audio",
    APP_ORIGINS: "",
    POLISH_MAX_VERSIONS: 5,
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
    SITE_BASE_URL: "https://site.dailog.fm",

    ...extra,
  };
}

function makeApp(admin: AppDeps["admin"], auth: AppDeps["auth"]) {
  const env = baseEnv();
  return createApp({
    env, auth, repo: fakeRepo(),
    importDeps: fakeImportDeps(),
    polishesDeps: fakePolishesDeps(),
    transcriptsDeps: fakeTranscriptsDeps(),
    episodesDeps: fakeEpisodesDeps(),
    job: fakeJob(), voice: fakeVoice(),
    channel: { activateChannel: async () => ({ ok: true }) },
    favorites: { getPublishableEpisode: async () => null, toggleFavorite: async () => ({ favorited: true }), toggleLike: async () => ({ liked: true }), listFavorites: async () => [] },
    admin,
  });
}

describe("admin invite endpoints (fake deps)", () => {
  it("rejects unauthenticated request with 401", async () => {
    const app = makeApp(fakeAdmin(), fakeAuth(null));
    const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(401);
  });

  it("rejects non-admin with 403 forbidden", async () => {
    const app = makeApp(fakeAdmin({ isAdmin: async () => false }), fakeAuth());
    const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });

  it("creates invite code (201) with auto-generated code when code omitted", async () => {
    const app = makeApp(fakeAdmin(), fakeAuth());
    const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ code: "dlg-auto1234", expiresAt: null });
  });

  it("creates invite code with explicit code and expiresDays", async () => {
    const app = makeApp(fakeAdmin(), fakeAuth());
    const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "VIP-2026", expiresDays: 30 }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; expiresAt: string };
    expect(body.code).toBe("VIP-2026");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86400_000);
  });

  it("rejects duplicate code with 400 duplicate_invite_code", async () => {
    const app = makeApp(fakeAdmin({ createInviteCode: async () => ({ error: "duplicate_invite_code" }) }), fakeAuth());
    const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "DUP-1" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "duplicate_invite_code" });
  });

  it("rejects malformed code with 400 invalid_invite_code", async () => {
    const app = makeApp(fakeAdmin(), fakeAuth());
    for (const code of ["ab", "a".repeat(65), "bad code!", "含中文"]) {
      const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_invite_code" });
    }
  });

  it("rejects malformed expiresDays with 400 invalid_expires_days", async () => {
    const app = makeApp(fakeAdmin(), fakeAuth());
    for (const expiresDays of [0, -1, 3651, 1.5, "30"]) {
      const res = await app.request("/v1/admin/invite-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresDays }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_expires_days" });
    }
  });
});

describe.skipIf(!hasDb)("admin invite endpoints (real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let adminUserId: string;
  let adminEmail: string;
  let normalToken: string;

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);
    adminEmail = `adm-admin-${randomUUID().slice(0, 8)}@test.local`;
    const testEnv = baseEnv({ ADMIN_EMAILS: adminEmail });
    const auth = createAuth({ db: dbClient.db, secret: "test-secret", env: testEnv as never });
    app = createApp({
      env: testEnv as never,
      auth,
      repo: fakeRepo(),
      importDeps: fakeImportDeps(),
      polishesDeps: fakePolishesDeps(),
      transcriptsDeps: fakeTranscriptsDeps(),
      episodesDeps: fakeEpisodesDeps(),
      job: fakeJob(),
      voice: fakeVoice(),
      channel: { activateChannel: async () => ({ ok: true }) },
      favorites: { getPublishableEpisode: async () => null, toggleFavorite: async () => ({ favorited: true }), toggleLike: async () => ({ liked: true }), listFavorites: async () => [] },
      admin: createAdminDeps(dbClient.db, adminEmail),
    });

    // 管理员（白名单邮箱）与普通用户各注册一个，拿真实 token
    const adminRes = await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "password123", name: "管理员" }),
    });
    expect(adminRes.status).toBe(200);
    const adminBody = (await adminRes.json()) as { token: string; user: { id: string } };
    adminToken = adminBody.token;
    adminUserId = adminBody.user.id;

    const normalRes = await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `adm-user-${randomUUID().slice(0, 8)}@test.local`, password: "password123", name: "普通用户" }),
    });
    expect(normalRes.status).toBe(200);
    const normalBody = (await normalRes.json()) as { token: string };
    normalToken = normalBody.token;
  });

  afterAll(async () => {
    if (dbClient) {
      // createdBy 引用 authUsers（无级联），先删邀请码再删用户
      await dbClient.db.delete(schema.inviteCodes).where(eq(schema.inviteCodes.createdBy, adminUserId));
      await dbClient.db.delete(schema.authUsers).where(like(schema.authUsers.email, "adm-%@test.local"));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("creates invite code with explicit code → row persisted with source=admin", async () => {
    const code = `adm-code-${randomUUID().slice(0, 8)}`;
    const res = await app.request("/v1/admin/invite-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ code, expiresAt: null });

    const rows = await dbClient.db
      .select({ source: schema.inviteCodes.source, createdBy: schema.inviteCodes.createdBy, usedBy: schema.inviteCodes.usedBy })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, code));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "admin", createdBy: adminUserId, usedBy: null });
  });

  it("rejects duplicate code", async () => {
    const code = `adm-code-${randomUUID().slice(0, 8)}`;
    await app.request("/v1/admin/invite-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ code }),
    });
    const res = await app.request("/v1/admin/invite-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "duplicate_invite_code" });
  });

  it("creates invite code with expiresDays → expires_at ≈ now + days", async () => {
    const res = await app.request("/v1/admin/invite-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ expiresDays: 30 }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; expiresAt: string };
    expect(body.code).toMatch(/^dlg-[0-9a-f]{8}$/);
    const expires = new Date(body.expiresAt).getTime();
    expect(expires).toBeGreaterThan(Date.now() + 29 * 86400_000);
    expect(expires).toBeLessThan(Date.now() + 31 * 86400_000);
  });

  it("rejects non-whitelisted user with 403", async () => {
    const res = await app.request("/v1/admin/invite-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${normalToken}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  });
});
