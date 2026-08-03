import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { createApp, type AppDeps, type AuthLike } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import * as schema from "../src/db/schema";

// 认证全链路测试：真实 better-auth + 本地 PG（门控；无 DATABASE_URL 时跳过）
const hasDb = Boolean(process.env.DATABASE_URL);

function fakeRepo(): AppDeps["repo"] {
  return {
    imports: {
      findImportBySource: async () => null,
      insertImport: async () => ({ id: "imp-1" }),
      insertEpisode: async () => ({ id: "ep-1" }),
      createImport: async () => ({ importId: "imp-1", episodeId: "ep-1" }),
    },
    episodes: {
      listEpisodes: async () => [],
      getEpisode: async () => null,
      saveScript: async (episodeId, version, segments) => ({ episodeId, version, segments }),
      getLatestScript: async () => null,
      getImportedDialogue: async () => null,
      setPublished: async () => {},
      setEpisodeLanguage: async () => {},
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      saveVoiceSample: async () => {},
      getVoiceSample: async () => null,
      getEpisodeAudio: async () => null,
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

function fakePolish(): AppDeps["polish"] {
  return {
    getDialogueMessages: async () => [],
    qualityCheck: async () => ({ pass: true, language: "zh" }),
    savePolished: async (_episodeId, _language, segments) => ({ version: 1, segments }),
    llm: { complete: async () => "", stream: async () => "" },
  };
}

function fakeGenerate(): AppDeps["generate"] {
  return {
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestScript: async () => null,
    safetyCheck: async () => ({ pass: true }),
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
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
    tts: null,
    storage: { put: async () => {}, get: async () => new Uint8Array() },
  };
}

describe.skipIf(!hasDb)("auth (better-auth, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let adminUserId: string;

  const email = () => `auth-${randomUUID().slice(0, 8)}@test.local`;
  const INVALID_CODE = "no-such-code-xyz";
  /** 每个用例独立邀请码（避免用例间 used 状态污染） */
  const freshCode = () => `auth-code-${randomUUID().slice(0, 8)}`;
  const insertInvite = async (code: string, expiresAt: Date | null = null) => {
    await dbClient!.db.insert(schema.inviteCodes).values({
      code, createdBy: adminUserId, source: "admin", expiresAt,
    });
  };

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);
    // admin user（invite_codes.created_by 引用 user.id）
    const admin = await dbClient.db
      .insert(schema.authUsers)
      .values({
        id: `admin-${randomUUID()}`,
        name: "Admin",
        email: `auth-admin-${randomUUID().slice(0, 8)}@test.local`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: schema.authUsers.id });
    adminUserId = admin[0].id;

    const auth = createAuth({ db: dbClient.db, secret: "test-secret" });
    app = createApp({
      env: {
        DATABASE_URL: process.env.DATABASE_URL!,
        BETTER_AUTH_SECRET: "test-secret",
        PORT: 8787,
        DEEPSEEK_API_KEY: "",
        DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
        DEEPSEEK_MODEL: "deepseek-chat",
        FISH_API_KEY: "",
        STORAGE_DRIVER: "fs",
        STORAGE_DIR: "./data",
        ASSETS_DIR: "assets/audio",
        APP_ORIGINS: "",
      },
      auth,
      repo: fakeRepo(),
      polish: fakePolish(),
      generate: fakeGenerate(),
      job: fakeJob(),
      voice: fakeVoice(),
    });
  });

  afterAll(async () => {
    if (dbClient) {
      // 清理顺序：先删邀请码（used_by 引用 user，无 cascade），再删测试用户（级联 profiles/sessions/accounts）
      await dbClient.db
        .delete(schema.inviteCodes)
        .where(like(schema.inviteCodes.code, "auth-%"));
      await dbClient.db
        .delete(schema.authUsers)
        .where(like(schema.authUsers.email, "auth-%@test.local"));
      await dbClient.client.end().catch(() => {});
    }
  });

  it("rejects sign-up without invite code (400 invalid_invite_code)", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email(), password: "password123", name: "无码用户" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { message?: string };
    expect(JSON.stringify(json)).toContain("invalid_invite_code");
  });

  it("rejects sign-up with unknown invite code", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email(), password: "password123", name: "错码用户", inviteCode: INVALID_CODE }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects sign-up with expired invite code", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email(), password: "password123", name: "过期码用户", inviteCode: "auth-expired-code" }),
    });
    expect(res.status).toBe(400);
  });

  it("signs up with valid invite code → token, profile row, invite marked used", async () => {
    const mail = email();
    const code = freshCode();
    await insertInvite(code);
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: "password123", name: "新用户", inviteCode: code }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { token?: string; user?: { id: string } };
    expect(typeof json.token).toBe("string");
    expect(json.user?.id).toBeTruthy();

    // profile 行已创建（after hook）
    const profiles = await dbClient.db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, json.user!.id));
    expect(profiles.length).toBe(1);

    // 邀请码已标记使用
    const codes = await dbClient.db
      .select({ usedBy: schema.inviteCodes.usedBy, usedAt: schema.inviteCodes.usedAt })
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.code, code));
    expect(codes[0]?.usedBy).toBe(json.user!.id);
    expect(codes[0]?.usedAt).toBeTruthy();

    // 带 token 访问受保护接口
    const me = await app.request("/api/me", {
      headers: { Authorization: `Bearer ${json.token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()) as { userId: string }).toEqual({ userId: json.user!.id });
  });

  it("signs in and get-session restores via bearer token", async () => {
    const mail = email();
    const code = freshCode();
    await insertInvite(code);
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: "password123", name: "登录用户", inviteCode: code }),
    });
    const signIn = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: mail, password: "password123" }),
    });
    expect(signIn.status).toBe(200);
    const { token, user } = (await signIn.json()) as { token: string; user: { id: string } };

    const session = await app.request("/api/auth/get-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user?: { id: string } };
    expect(body.user?.id).toBe(user.id);
  });

  it("rejects invalid bearer token with 401", async () => {
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer garbage-token" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects missing token with 401", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });
});
