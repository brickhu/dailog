import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp, type AppDeps } from "../src/app";
import { createDb } from "../src/db/client";
import { createRepo } from "../src/repo";
import type { Env } from "../src/config/env";
import { episodes, generationJobs, imports, profiles } from "../src/db/schema";
import type { EpisodeRow, ImportRow } from "../src/routes/imports";

const hasDb = Boolean(process.env.DATABASE_URL);

// profiles.id 是 uuid 列，测试用户需用合法 uuid
const REPO_USER = "11111111-1111-4111-8111-111111111111";
const API_USER = "22222222-2222-4222-8222-222222222222";
const QUOTA_USER = "33333333-3333-4333-8333-333333333333";

function makeEnv(): Env {
  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_JWKS_URL: "https://example.supabase.co/auth/v1/jwks",
    PORT: 8787,
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    DEEPSEEK_MODEL: "deepseek-chat",
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
  };
}

describe.skipIf(!hasDb)("drizzle repo (integration, local PG)", () => {
  const { db, client } = createDb(makeEnv());
  const repo = createRepo(db);

  beforeAll(async () => {
    await db.insert(profiles).values([
      { id: REPO_USER, username: "repo-test-user", displayName: "Repo Test" },
      { id: API_USER, username: "api-test-user", displayName: "API Test" },
      // 配额测试种子：free + 5 积分
      { id: QUOTA_USER, username: "quota-test-user", displayName: "Quota Test", plan: "free", creditBalance: 5 },
    ]).onConflictDoNothing();
  });

  afterAll(async () => {
    // profile 级联删除 imports/episodes/scripts/generation_jobs
    await db.delete(profiles).where(eq(profiles.id, REPO_USER));
    await db.delete(profiles).where(eq(profiles.id, API_USER));
    await db.delete(profiles).where(eq(profiles.id, QUOTA_USER));
    await client.end();
  });

  describe("imports repo", () => {
    it("createImport inserts import + episode in one transaction", async () => {
      const conv = `conv-${Date.now()}-1`;
      const result = await repo.imports.createImport(
        {
          userId: REPO_USER, platform: "claude", sourceTitle: "集成测试", sourceConversationId: conv,
          sourceUrl: `https://claude.ai/chat/${conv}`,
          parsedDialogue: { platform: "claude", conversationId: conv, title: "集成测试", url: `https://claude.ai/chat/${conv}`, messages: [{ role: "user", content: "你好" }] },
        },
        { userId: REPO_USER, title: "集成测试", status: "draft", language: null },
      );
      if ("duplicate" in result) throw new Error("unexpected duplicate");
      const found = await repo.imports.findImportBySource(REPO_USER, "claude", conv);
      expect(found?.id).toBe(result.importId);
      const ep = await repo.episodes.getEpisode(result.episodeId);
      expect(ep).toMatchObject({ id: result.episodeId, userId: REPO_USER, title: "集成测试", status: "draft" });
    });

    it("duplicate source: createImport returns { duplicate: true } and leaves no orphan rows", async () => {
      const conv = `conv-${Date.now()}-2`;
      const row: ImportRow = {
        userId: REPO_USER, platform: "claude", sourceTitle: "重复导入", sourceConversationId: conv,
        sourceUrl: `https://claude.ai/chat/${conv}`,
        parsedDialogue: { platform: "claude", conversationId: conv, title: "重复导入", url: `https://claude.ai/chat/${conv}`, messages: [{ role: "user", content: "你好" }] },
      };
      const episodeRow: EpisodeRow = { userId: REPO_USER, title: "重复导入", status: "draft", language: null };
      const first = await repo.imports.createImport(row, episodeRow);
      if ("duplicate" in first) throw new Error("unexpected duplicate");
      const episodesBefore = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.userId, REPO_USER));
      const dup = await repo.imports.createImport(row, episodeRow);
      expect(dup).toEqual({ duplicate: true });
      const importRows = await db.select({ id: imports.id }).from(imports).where(eq(imports.sourceConversationId, conv));
      expect(importRows).toHaveLength(1);
      const episodesAfter = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.userId, REPO_USER));
      expect(episodesAfter).toHaveLength(episodesBefore.length);
    });

    it("insertImport surfaces unique violation as { duplicate: true }", async () => {
      const conv = `conv-${Date.now()}-3`;
      const row: ImportRow = {
        userId: REPO_USER, platform: "deepseek", sourceTitle: "单条插入", sourceConversationId: conv,
        sourceUrl: `https://chat.deepseek.com/${conv}`,
        parsedDialogue: { platform: "deepseek", conversationId: conv, title: "单条插入", url: `https://chat.deepseek.com/${conv}`, messages: [{ role: "user", content: "你好" }] },
      };
      const first = await repo.imports.insertImport(row);
      if ("duplicate" in first) throw new Error("unexpected duplicate");
      const second = await repo.imports.insertImport(row);
      expect(second).toEqual({ duplicate: true });
    });

    it("findImportBySource returns null for unknown source", async () => {
      const found = await repo.imports.findImportBySource(REPO_USER, "claude", `conv-missing-${Date.now()}`);
      expect(found).toBeNull();
    });
  });

  describe("episodes repo", () => {
    async function makeEpisode(title: string): Promise<string> {
      const conv = `conv-ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await repo.imports.createImport(
        {
          userId: REPO_USER, platform: "kimi", sourceTitle: title, sourceConversationId: conv,
          sourceUrl: `https://kimi.com/chat/${conv}`,
          parsedDialogue: { platform: "kimi", conversationId: conv, title, url: `https://kimi.com/chat/${conv}`, messages: [{ role: "user", content: "你好" }] },
        },
        { userId: REPO_USER, title, status: "draft", language: null },
      );
      if ("duplicate" in result) throw new Error("unexpected duplicate");
      return result.episodeId;
    }

    it("saveScript increments version and getLatestScript returns newest", async () => {
      const episodeId = await makeEpisode("脚本测试");
      const v1 = await repo.episodes.saveScript(episodeId, 1, [{ speaker: "host", text: "你好" }]);
      expect(v1).toEqual({ episodeId, version: 1, segments: [{ speaker: "host", text: "你好" }] });
      const v2 = await repo.episodes.saveScript(episodeId, 2, [{ speaker: "host", text: "你好2" }]);
      expect(v2.version).toBe(2);
      const latest = await repo.episodes.getLatestScript(episodeId);
      expect(latest).toMatchObject({ version: 2 });
      expect(latest?.segments).toEqual([{ speaker: "host", text: "你好2" }]);
    });

    it("getLatestScript returns null when no script saved", async () => {
      const episodeId = await makeEpisode("无脚本");
      expect(await repo.episodes.getLatestScript(episodeId)).toBeNull();
    });

    it("getImportedDialogue returns messages via episodes.import_id link", async () => {
      const episodeId = await makeEpisode("对话来源");
      const messages = await repo.episodes.getImportedDialogue(episodeId, REPO_USER);
      expect(messages).toEqual([{ role: "user", content: "你好" }]);
    });

    it("getImportedDialogue returns null for other user's episode (IDOR 过滤)", async () => {
      const episodeId = await makeEpisode("他人对话");
      expect(await repo.episodes.getImportedDialogue(episodeId, API_USER)).toBeNull();
      expect(await repo.episodes.getImportedDialogue("00000000-0000-4000-8000-000000000000", REPO_USER)).toBeNull();
    });

    it("setPublished updates status and publishedAt", async () => {
      const episodeId = await makeEpisode("发布测试");
      await repo.episodes.setPublished(episodeId);
      const ep = await repo.episodes.getEpisode(episodeId);
      expect(ep?.status).toBe("published");
      const row = await db.select({ publishedAt: episodes.publishedAt }).from(episodes).where(eq(episodes.id, episodeId));
      expect(row[0].publishedAt).toBeInstanceOf(Date);
    });
  });

  describe("jobs repo", () => {
    async function makeEpisode(title: string): Promise<string> {
      const conv = `conv-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await repo.imports.createImport(
        {
          userId: QUOTA_USER, platform: "doubao", sourceTitle: title, sourceConversationId: conv,
          sourceUrl: `https://doubao.com/chat/${conv}`,
          parsedDialogue: { platform: "doubao", conversationId: conv, title, url: `https://doubao.com/chat/${conv}`, messages: [{ role: "user", content: "你好" }] },
        },
        { userId: QUOTA_USER, title, status: "draft", language: null },
      );
      if ("duplicate" in result) throw new Error("unexpected duplicate");
      return result.episodeId;
    }

    it("getQuotaInfo returns plan/credit_balance and counts only done jobs", async () => {
      const episodeId = await makeEpisode("配额统计");
      const before = await repo.jobs.getQuotaInfo(QUOTA_USER);
      expect(before).toMatchObject({ plan: "free", generatedCount: 0, creditBalance: 5 });

      const job = await repo.jobs.createJob(episodeId);
      expect(job).toMatchObject({ episodeId, status: "queued", progress: 0 });
      // queued 未完成：不计入 generatedCount
      expect((await repo.jobs.getQuotaInfo(QUOTA_USER)).generatedCount).toBe(0);

      await db.update(generationJobs).set({ status: "done" }).where(eq(generationJobs.id, job.id));
      expect((await repo.jobs.getQuotaInfo(QUOTA_USER)).generatedCount).toBe(1);
      // 其他用户 job 不计入（归属过滤）
      expect((await repo.jobs.getQuotaInfo(REPO_USER)).generatedCount).toBe(0);
    });

    it("consumeQuota decrements credit_balance for free; pro no-op", async () => {
      await repo.jobs.consumeQuota(QUOTA_USER, 1);
      let row = await db.select({ balance: profiles.creditBalance }).from(profiles).where(eq(profiles.id, QUOTA_USER));
      expect(row[0].balance).toBe(4);

      await db.update(profiles).set({ plan: "pro" }).where(eq(profiles.id, QUOTA_USER));
      await repo.jobs.consumeQuota(QUOTA_USER, 1);
      row = await db.select({ balance: profiles.creditBalance }).from(profiles).where(eq(profiles.id, QUOTA_USER));
      expect(row[0].balance).toBe(4);

      // 恢复 free 供后续用例使用
      await db.update(profiles).set({ plan: "free" }).where(eq(profiles.id, QUOTA_USER));
    });

    it("getLatestJob returns newest job by created_at desc, or null", async () => {
      const episodeId = await makeEpisode("最新 job");
      expect(await repo.jobs.getLatestJob(episodeId)).toBeNull();

      const j1 = await repo.jobs.createJob(episodeId);
      await db.update(generationJobs)
        .set({ createdAt: new Date(Date.now() - 60_000) })
        .where(eq(generationJobs.id, j1.id));
      const j2 = await repo.jobs.createJob(episodeId);

      const latest = await repo.jobs.getLatestJob(episodeId);
      expect(latest?.id).toBe(j2.id);
      expect(latest).toMatchObject({ status: "queued", progress: 0, error: null });
    });
  });

  describe("api via real repo", () => {
    const polish: AppDeps["polish"] = {
      getDialogueMessages: (episodeId, userId) => repo.episodes.getImportedDialogue(episodeId, userId),
      qualityCheck: async () => ({ pass: true, language: "zh" }),
      savePolished: async (episodeId, _language, segments) => {
        const latest = await repo.episodes.getLatestScript(episodeId);
        return repo.episodes.saveScript(episodeId, (latest?.version ?? 0) + 1, segments);
      },
      llm: {
        complete: async () => "",
        stream: async (_msgs, onDelta) => {
          const json = '[{"speaker":"host","text":"你好"},{"speaker":"guest","text":"你好！"}]';
          onDelta(json);
          return json;
        },
      },
    };
    const generate: AppDeps["generate"] = {
      getOwnedEpisode: (episodeId, userId) => repo.episodes.getEpisode(episodeId, userId),
      getLatestScript: (episodeId) => repo.episodes.getLatestScript(episodeId),
      safetyCheck: async () => ({ pass: true }),
      getQuota: (userId) => repo.jobs.getQuotaInfo(userId),
      consumeQuota: (userId, credit) => repo.jobs.consumeQuota(userId, credit),
      createJob: (episodeId) => repo.jobs.createJob(episodeId),
      enqueueJob: async () => {},
    };
    const job: AppDeps["job"] = {
      getLatestJob: (episodeId) => repo.jobs.getLatestJob(episodeId),
    };
    const app = createApp({
      env: makeEnv(),
      verifyToken: async (token: string) => {
        if (token !== "valid-token") throw new Error("invalid token");
        return { sub: API_USER };
      },
      repo,
      polish,
      generate,
      job,
    });

    it("POST /api/imports 201 then 409; episodes list/script/publish flow", async () => {
      const conv = `conv-api-${Date.now()}`;
      const body = {
        platform: "claude", conversationId: conv, title: "HTTP 集成", url: `https://claude.ai/chat/${conv}`,
        messages: [{ role: "user", content: "hi" }],
      };
      const headers = { "Content-Type": "application/json", Authorization: "Bearer valid-token" };
      const res = await app.request("/api/imports", { method: "POST", headers, body: JSON.stringify(body) });
      expect(res.status).toBe(201);
      const { episodeId } = (await res.json()) as { importId: string; episodeId: string };

      const dup = await app.request("/api/imports", { method: "POST", headers, body: JSON.stringify(body) });
      expect(dup.status).toBe(409);

      const list = await app.request("/api/episodes", { headers: { Authorization: "Bearer valid-token" } });
      expect(list.status).toBe(200);
      const listJson = (await list.json()) as Array<{ id: string; title: string | null; status: string }>;
      expect(listJson).toEqual(expect.arrayContaining([expect.objectContaining({ id: episodeId, title: "HTTP 集成" })]));

      const script = await app.request(`/api/episodes/${episodeId}/script`, {
        method: "PUT", headers,
        body: JSON.stringify({ segments: [{ speaker: "host", text: "脚本一" }] }),
      });
      expect(script.status).toBe(200);
      expect((await script.json()) as { version: number }).toMatchObject({ version: 1 });

      const publish = await app.request(`/api/episodes/${episodeId}/publish`, {
        method: "POST", headers: { Authorization: "Bearer valid-token" },
      });
      expect(publish.status).toBe(200);
      expect(await publish.json()).toEqual({ ok: true });

      const detail = await app.request(`/api/episodes/${episodeId}`, { headers: { Authorization: "Bearer valid-token" } });
      expect(detail.status).toBe(200);
      expect((await detail.json()) as { status: string }).toMatchObject({ status: "published" });
    });

    it("POST /api/episodes/:id/polish streams SSE and saves polished script", async () => {
      const conv = `conv-polish-${Date.now()}`;
      const body = {
        platform: "claude", conversationId: conv, title: "润色集成", url: `https://claude.ai/chat/${conv}`,
        messages: [{ role: "user", content: "你好" }, { role: "assistant", content: "你好！" }],
      };
      const headers = { "Content-Type": "application/json", Authorization: "Bearer valid-token" };
      const res = await app.request("/api/imports", { method: "POST", headers, body: JSON.stringify(body) });
      expect(res.status).toBe(201);
      const { episodeId } = (await res.json()) as { importId: string; episodeId: string };

      const polishRes = await app.request(`/api/episodes/${episodeId}/polish`, { method: "POST", headers: { Authorization: "Bearer valid-token" } });
      expect(polishRes.status).toBe(200);
      const text = await polishRes.text();
      expect(text).toContain("event: segment");
      expect(text).toContain("event: done");
      const latest = await repo.episodes.getLatestScript(episodeId);
      expect(latest?.version).toBe(1);
      expect(latest?.segments).toEqual([
        { speaker: "host", text: "你好" },
        { speaker: "guest", text: "你好！" },
      ]);
    });

    it("POST /api/episodes/:id/generate creates job; GET job returns it", async () => {
      const conv = `conv-gen-${Date.now()}`;
      const body = {
        platform: "claude", conversationId: conv, title: "生成集成", url: `https://claude.ai/chat/${conv}`,
        messages: [{ role: "user", content: "你好" }],
      };
      const headers = { "Content-Type": "application/json", Authorization: "Bearer valid-token" };
      const res = await app.request("/api/imports", { method: "POST", headers, body: JSON.stringify(body) });
      expect(res.status).toBe(201);
      const { episodeId } = (await res.json()) as { importId: string; episodeId: string };

      const scriptRes = await app.request(`/api/episodes/${episodeId}/script`, {
        method: "PUT", headers,
        body: JSON.stringify({ segments: [{ speaker: "host", text: "生成脚本" }] }),
      });
      expect(scriptRes.status).toBe(200);

      const balanceBefore = (await repo.jobs.getQuotaInfo(API_USER)).creditBalance;
      const gen = await app.request(`/api/episodes/${episodeId}/generate`, {
        method: "POST", headers: { Authorization: "Bearer valid-token" },
      });
      expect(gen.status).toBe(202);
      const genJson = (await gen.json()) as { jobId: string; status: string };
      expect(genJson.status).toBe("queued");

      const jobRes = await app.request(`/api/episodes/${episodeId}/job`, {
        headers: { Authorization: "Bearer valid-token" },
      });
      expect(jobRes.status).toBe(200);
      expect(await jobRes.json()).toMatchObject({ id: genJson.jobId, status: "queued", progress: 0, error: null });

      // 配额视角：job 尚未 done，generatedCount 仍为 0；free 首集为免费额度，不扣 credit
      const quota = await repo.jobs.getQuotaInfo(API_USER);
      expect(quota.generatedCount).toBe(0);
      expect(quota.creditBalance).toBe(balanceBefore);
    });

    it("GET /api/episodes/:id/job returns 404 when no job", async () => {
      const conv = `conv-nojob-${Date.now()}`;
      const body = {
        platform: "claude", conversationId: conv, title: "无 job 集成", url: `https://claude.ai/chat/${conv}`,
        messages: [{ role: "user", content: "你好" }],
      };
      const headers = { "Content-Type": "application/json", Authorization: "Bearer valid-token" };
      const res = await app.request("/api/imports", { method: "POST", headers, body: JSON.stringify(body) });
      expect(res.status).toBe(201);
      const { episodeId } = (await res.json()) as { importId: string; episodeId: string };

      const jobRes = await app.request(`/api/episodes/${episodeId}/job`, {
        headers: { Authorization: "Bearer valid-token" },
      });
      expect(jobRes.status).toBe(404);
      expect(await jobRes.json()).toEqual({ error: "not_found" });
    });
  });
});
