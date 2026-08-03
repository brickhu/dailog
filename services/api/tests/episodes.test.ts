import { describe, expect, it } from "vitest";
import { episodesRoutes, type EpisodesRepo, type ScriptSegment } from "../src/routes/episodes";

function fakeRepo(): EpisodesRepo {
  const episodes = new Map<string, { id: string; userId: string; title: string | null; status: string; platform: string | null; createdAt: Date }>([
    ["ep-1", { id: "ep-1", userId: "user-1", title: "测试对话", status: "draft", platform: "deepseek", createdAt: new Date("2026-01-01T00:00:00Z") }],
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
    getPublishedDialogue: async () => null,
    setPublished: async (id) => { episodes.get(id)!.status = "published"; },
    setEpisodeLanguage: async () => {},
    getEpisodeUserId: async () => null,
    getEpisodeLanguage: async () => null,
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
    getPolishCount: async () => 0,
    incrementPolishCount: async () => {},
    saveVoiceSample: async () => {},
    getVoiceSample: async () => null,
    getEpisodeAudio: async () => null,
    getChannelActivatedAt: async () => new Date(),
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

  it("GET script returns 404 before first polish, then saved script", async () => {
    const repo = fakeRepo();
    const app = episodesRoutes(repo, () => "user-1");
    const before = await app.request("/episodes/ep-1/script");
    expect(before.status).toBe(404);
    // 先存一版，再读取
    await app.request("/episodes/ep-1/script", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments: [{ speaker: "host", text: "你好" }] }),
    });
    const after = await app.request("/episodes/ep-1/script");
    expect(after.status).toBe(200);
    const json = await after.json();
    expect(json).toMatchObject({ version: 1, segments: [{ speaker: "host", text: "你好" }] });
  });

  it("streams audio when episode has audio (GET /episodes/:id/audio)", async () => {
    const repo = fakeRepo();
    const storage = {
      get: async (key: string) => new Uint8Array([0x49, 0x44, 0x33, 0x01]), // "ID3" 音频头
    };
    const app = episodesRoutes(
      { ...repo, getEpisodeAudio: async () => "audio/episodes/ep-1.mp3" },
      () => "user-1",
      storage,
    );
    const res = await app.request("/episodes/ep-1/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([0x49, 0x44, 0x33, 0x01]);
  });

  it("returns 404 for audio when episode has no audio yet", async () => {
    const app = episodesRoutes(fakeRepo(), () => "user-1", { get: async () => new Uint8Array() });
    const res = await app.request("/episodes/ep-1/audio");
    expect(res.status).toBe(404);
  });

  it("returns 404 for audio when storage read fails", async () => {
    const repo = fakeRepo();
    const app = episodesRoutes(
      { ...repo, getEpisodeAudio: async () => "audio/episodes/missing.mp3" },
      () => "user-1",
      { get: async () => { throw new Error("ENOENT"); } },
    );
    const res = await app.request("/episodes/ep-1/audio");
    expect(res.status).toBe(404);
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
