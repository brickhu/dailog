import { describe, expect, it } from "vitest";
import { episodesRoutes, type EpisodesRepo, type ScriptSegment } from "../src/routes/episodes";

function fakeRepo(): EpisodesRepo {
  const episodes = new Map<string, { id: string; userId: string; title: string | null; status: string; createdAt: Date }>([
    ["ep-1", { id: "ep-1", userId: "user-1", title: "测试对话", status: "draft", createdAt: new Date("2026-01-01T00:00:00Z") }],
  ]);
  const scripts: Array<{ episodeId: string; version: number; segments: ScriptSegment[] }> = [];
  return {
    listEpisodes: async (userId) => [...episodes.values()].filter((e) => e.userId === userId),
    getEpisode: async (id, userId) => {
      const ep = episodes.get(id);
      return ep && (!userId || ep.userId === userId) ? ep : null;
    },
    saveScript: async (episodeId, version, segments) => {
      scripts.push({ episodeId, version, segments });
      return { episodeId, version, segments };
    },
    getLatestScript: async (episodeId) => scripts.filter((s) => s.episodeId === episodeId).at(-1) ?? null,
    getImportedDialogue: async () => null,
    setPublished: async (id) => { episodes.get(id)!.status = "published"; },
    getEpisodeUserId: async () => null,
    getEpisodeLanguage: async () => null,
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
  };
}

describe("episodes routes", () => {
  it("lists episodes for current user", async () => {
    const app = episodesRoutes(fakeRepo(), () => "user-1");
    const res = await app.request("/episodes");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ id: "ep-1", title: "测试对话" });
  });

  it("returns 404 for unknown episode", async () => {
    const app = episodesRoutes(fakeRepo(), () => "user-1");
    const res = await app.request("/episodes/ep-nope");
    expect(res.status).toBe(404);
  });

  it("saves script with incremented version", async () => {
    const repo = fakeRepo();
    const app = episodesRoutes(repo, () => "user-1");
    const res = await app.request("/episodes/ep-1/script", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: [{ speaker: "host", text: "你好" }] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.version).toBe(1);
    // 再存一次 version 递增
    const res2 = await app.request("/episodes/ep-1/script", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: [{ speaker: "host", text: "你好2" }] }),
    });
    expect((await res2.json()).version).toBe(2);
  });

  it("publishes episode", async () => {
    const app = episodesRoutes(fakeRepo(), () => "user-1");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("ownership scoping", () => {
  it("does not expose another user's episode", async () => {
    const app = episodesRoutes(fakeRepo(), () => "other-user");
    const res = await app.request("/episodes/ep-1");
    expect(res.status).toBe(404);
  });
  it("does not publish another user's episode", async () => {
    const app = episodesRoutes(fakeRepo(), () => "other-user");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
