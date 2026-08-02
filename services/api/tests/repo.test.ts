import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { createDb } from "../src/db/client";
import { createRepo } from "../src/repo";
import type { Env } from "../src/config/env";
import { episodes, imports, profiles } from "../src/db/schema";
import type { EpisodeRow, ImportRow } from "../src/routes/imports";

const hasDb = Boolean(process.env.DATABASE_URL);

// profiles.id 是 uuid 列，测试用户需用合法 uuid
const REPO_USER = "11111111-1111-4111-8111-111111111111";
const API_USER = "22222222-2222-4222-8222-222222222222";

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
    ]).onConflictDoNothing();
  });

  afterAll(async () => {
    // profile 级联删除 imports/episodes/scripts
    await db.delete(profiles).where(eq(profiles.id, REPO_USER));
    await db.delete(profiles).where(eq(profiles.id, API_USER));
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

    it("setPublished updates status and publishedAt", async () => {
      const episodeId = await makeEpisode("发布测试");
      await repo.episodes.setPublished(episodeId);
      const ep = await repo.episodes.getEpisode(episodeId);
      expect(ep?.status).toBe("published");
      const row = await db.select({ publishedAt: episodes.publishedAt }).from(episodes).where(eq(episodes.id, episodeId));
      expect(row[0].publishedAt).toBeInstanceOf(Date);
    });
  });

  describe("api via real repo", () => {
    const app = createApp({
      env: makeEnv(),
      verifyToken: async (token: string) => {
        if (token !== "valid-token") throw new Error("invalid token");
        return { sub: API_USER };
      },
      repo,
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
  });
});
