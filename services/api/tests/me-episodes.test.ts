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
// 列表（仅本人、含已下架、带申请状态）→ 申请下线（新建/重复/已下架/越权）→ 未登录

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
    const storageStub = { put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} };
    app = createApp({
      env: testEnv,
      auth,
      repo,
      voice: { saveVoiceSample: async () => ({ id: "" }), storage: storageStub },
      editor: { repo, env: testEnv, storage: storageStub, siteBaseUrl: null },
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
      body: JSON.stringify({ email: "meep-" + randomUUID().slice(0, 8) + "@test.local", password: "password123", name: "MeEp" }),
    });
    const body = (await res.json()) as { token: string; user: { id: string } };
    token = body.token;
    myId = body.user.id;

    // 另一用户（越权测试）
    const other = await dbClient.db.insert(schema.authUsers).values({
      id: "meep-other-" + randomUUID(),
      name: "Other",
      email: "meep-other-" + randomUUID().slice(0, 8) + "@test.local",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({ id: schema.authUsers.id });
    otherId = other[0].id;

    // 本人：一个公开 + 一个已下架
    const mkSub = (uid: string) => dbClient.db.insert(schema.submissions).values({
      userId: uid,
      url: "https://example.com/share/" + randomUUID(),
      status: "published",
    }).returning({ id: schema.submissions.id });
    const s1 = await mkSub(myId);
    const s2 = await mkSub(myId);
    const s3 = await mkSub(otherId);
    const insEp = (subId: string, uid: string, isPublic: boolean) =>
      dbClient.db.insert(schema.episodes).values({
        submissionId: subId,
        userId: uid,
        slug: "meep-ep-" + randomUUID().slice(0, 8),
        title: "我的节目",
        audioUrl: "episodes/" + uid + "/" + subId + ".mp3",
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

  const authHeaders = () => ({ Authorization: "Bearer " + token });
  const jsonHeaders = () => ({ ...authHeaders(), "Content-Type": "application/json" });

  it("列表只返回本人的节目（含已下架），带 removalRequest", async () => {
    const res = await app.request("/v1/me/episodes", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string; isPublic: boolean; removalRequest: unknown }>;
    const ids = list.map((e) => e.id);
    expect(ids).toContain(myPublicId);
    expect(ids).toContain(myHiddenId);
    expect(ids).not.toContain(otherEpId);
    expect(list.find((e) => e.id === myHiddenId)?.isPublic).toBe(false);
    expect(list.find((e) => e.id === myPublicId)?.removalRequest).toBeNull();
  });

  it("申请下线（公开节目）→ 201，列表显示 pending", async () => {
    const res = await app.request("/v1/me/episodes/" + myPublicId + "/unpublish-request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ reason: "隐私原因" }),
    });
    expect(res.status).toBe(201);
    const listRes = await app.request("/v1/me/episodes", { headers: authHeaders() });
    const list = (await listRes.json()) as Array<{ id: string; removalRequest: { status: string } | null }>;
    expect(list.find((e) => e.id === myPublicId)?.removalRequest?.status).toBe("pending");
  });

  it("重复申请（已有 pending）→ 409 request_pending", async () => {
    const res = await app.request("/v1/me/episodes/" + myPublicId + "/unpublish-request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ reason: "再申请一次" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("request_pending");
  });

  it("已下架节目申请下线 → 409 already_unlisted", async () => {
    const res = await app.request("/v1/me/episodes/" + myHiddenId + "/unpublish-request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("already_unlisted");
  });

  it("申请他人节目 → 404", async () => {
    const res = await app.request("/v1/me/episodes/" + otherEpId + "/unpublish-request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("申请不存在的节目 → 404", async () => {
    const res = await app.request("/v1/me/episodes/" + randomUUID() + "/unpublish-request", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("未登录 → 401", async () => {
    const res = await app.request("/v1/me/episodes");
    expect(res.status).toBe(401);
  });
});
