import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createAuth } from "../src/auth/better-auth";
import { createDb } from "../src/db/client";
import { createRepo } from "../src/repo";
import * as schema from "../src/db/schema";
import { createFavoritesRepo } from "../src/routes/favorites";

// /me/episodes 全链路（真实本地 PG + 真实 repo）：
// 列表（仅本人、含已下架）→ 下架/上架 → 越权/不存在 → 参数校验

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("me/episodes (我的节目, real local PG)", () => {
  let dbClient: ReturnType<typeof createDb>;
  let app: ReturnType<typeof createApp>;
  let token: string;
  let myId: string;
  let myPublicId: string;
  let myHiddenId: string;
  let otherId: string;
  let otherEpId: string;

  beforeAll(async () => {
    dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as never);
    const testEnv = {
      DATABASE_URL: process.env.DATABASE_URL!,
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "http://localhost:8787",
      PORT: 8787,
      FISH_API_KEY: "",
      STORAGE_DRIVER: "fs" as const,
      STORAGE_DIR: "./data",
      APP_ORIGINS: "",
      RESEND_API_KEY: "",
      EMAIL_FROM: "dailog <no-reply@dailog.fm>",
      ADMIN_EMAILS: "",
      SITE_BASE_URL: "https://dailog.fm",
    };
    const auth = createAuth({ db: dbClient.db, secret: "test-secret", env: testEnv });
    const repo = createRepo(dbClient.db);
    app = createApp({
      env: testEnv,
      auth,
      repo,
      voice: {
        saveVoiceSample: async () => ({ id: "" }),
        storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
      },
      editor: {
        repo,
        env: testEnv,
        storage: { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
        siteBaseUrl: null,
      },
      tts: {
        repo,
        storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} },
        ffmpegPath: "/fake/ffmpeg",
        fish: null,
      },
      favorites: createFavoritesRepo(dbClient.db),
    });

    // 注册真实用户拿 token（本人）
    const res = await app.request("/v1/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `meep-${randomUUID().slice(0, 8)}@test.local`, password: "password123", name: "MeEp" }),
    });
    const body = (await res.json()) as { token: string; user: { id: string } };
    token = body.token;
    myId = body.user.id;

    // 另一用户（越权测试）
    const other = await dbClient.db.insert(schema.authUsers).values({
      id: `meep-other-${randomUUID()}`,
      name: "Other",
      email: `meep-other-${randomUUID().slice(0, 8)}@test.local`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({ id: schema.authUsers.id });
    otherId = other[0].id;

    // 本人：一个公开 + 一个已下架
    const mkSub = (uid: string) => dbClient.db.insert(schema.submissions).values({
      userId: uid,
      url: `https://example.com/share/${randomUUID()}`,
      status: "published",
    }).returning({ id: schema.submissions.id });
    const s1 = await mkSub(myId);
    const s2 = await mkSub(myId);
    const s3 = await mkSub(otherId);
    const insEp = (subId: string, uid: string, isPublic: boolean) =>
      dbClient.db.insert(schema.episodes).values({
        submissionId: subId,
        userId: uid,
        slug: `meep-ep-${randomUUID().slice(0, 8)}`,
        title: "我的节目",
        audioUrl: `episodes/${uid}/${subId}.mp3`,
        status: "published",
        isPublic,
        publishedAt: new Date(),
      }).returning({ id: schema.episodes.id });
    myPublicId = (await insEp(s1[0].id, myId, true))[0].id;
    myHiddenId = (await insEp(s2[0].id, myId, false))[0].id;
    otherEpId = (await insEp(s3[0].id, otherId, true))[0].id;
  });

  afterAll(async () => {
    if (dbClient) {
      await dbClient.client.end();
    }
  });

  it("列表只返回本人的节目（含已下架），不含他人", async () => {
    const res = await app.request("/v1/me/episodes", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; isPublic: boolean }>;
    const ids = list.map((e) => e.id);
    expect(ids).toContain(myPublicId);
    expect(ids).toContain(myHiddenId);
    expect(ids).not.toContain(otherEpId);
    expect(list.find((e) => e.id === myHiddenId)?.isPublic).toBe(false);
  });

  it("下架自己的节目 → isPublic=false 持久化", async () => {
    const res = await app.request(`/v1/me/episodes/${myPublicId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    expect(res.status).toBe(200);
    const rows = await dbClient.db.select({ isPublic: schema.episodes.isPublic })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, myPublicId));
    expect(rows[0]?.isPublic).toBe(false);
  });

  it("重新上架 → isPublic=true", async () => {
    const res = await app.request(`/v1/me/episodes/${myPublicId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: true }),
    });
    expect(res.status).toBe(200);
    const rows = await dbClient.db.select({ isPublic: schema.episodes.isPublic })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, myPublicId));
    expect(rows[0]?.isPublic).toBe(true);
  });

  it("操作他人的节目 → 404（归属校验）", async () => {
    const res = await app.request(`/v1/me/episodes/${otherEpId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    expect(res.status).toBe(404);
  });

  it("不存在的节目 → 404", async () => {
    const res = await app.request(`/v1/me/episodes/${randomUUID()}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: false }),
    });
    expect(res.status).toBe(404);
  });

  it("非法参数（isPublic 非 boolean）→ 400", async () => {
    const res = await app.request(`/v1/me/episodes/${myPublicId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: "yes" }),
    });
    expect(res.status).toBe(400);
  });

  it("未登录 → 401", async () => {
    const res = await app.request("/v1/me/episodes");
    expect(res.status).toBe(401);
  });
});
