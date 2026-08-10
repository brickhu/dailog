import { describe, expect, it } from "vitest";
import { episodesRoutes, type EpisodesDeps } from "../src/routes/episodes";

// 新五层模型：episodes 由 transcript 生成（/episodes/new 选 transcript → 安全门 → 频道 → 配额 → job）
function fakeDeps(overrides: Partial<EpisodesDeps> = {}): EpisodesDeps {
  const deps: EpisodesDeps = {
    listByUser: async () => [
      { id: "ep-1", title: "测试对话", status: "generating", polishId: "p-1", createdAt: new Date("2026-01-01T00:00:00Z") },
    ],
    getOwned: async (id, userId) =>
      id === "ep-1" && userId === "user-1"
        ? { id: "ep-1", transcriptId: "t-1", polishId: "p-1", title: "测试对话", status: "generating" }
        : null,
    getEpisodeAudio: async () => null,
    getOwnedTranscript: async (id, userId) =>
      id === "t-1" && userId === "user-1"
        ? { id: "t-1", polishId: "p-1", segments: [{ speaker: "host", text: "你好" }], topic: null, language: null, guestId: null, snapshotId: null }
        : null,
    getEpisodeByTranscript: async () => null,
    createEpisode: async () => ({ id: "ep-1" }),
    safetyCheck: async () => ({ pass: true }),
    getChannelActive: async () => true,
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
    setPublished: async () => {},
    getChannelActivatedAt: async () => new Date(),
    getHostModelId: async () => null,
    getVoiceSampleKey: async () => null,
    getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      markUsed: async () => {},
    saveVoiceSample: async () => {},
  };
  return { ...deps, ...overrides };
}

describe("episodes routes", () => {
  it("lists episodes for current user", async () => {
    const app = episodesRoutes(fakeDeps(), () => "user-1");
    const res = await app.request("/episodes");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ id: "ep-1", title: "测试对话" });
  });

  it("returns episode detail (GET /episodes/:id)", async () => {
    const app = episodesRoutes(fakeDeps(), () => "user-1");
    const res = await app.request("/episodes/ep-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: "ep-1", transcriptId: "t-1", polishId: "p-1", title: "测试对话", status: "generating",
    });
  });

  it("returns 404 for unknown episode", async () => {
    const app = episodesRoutes(fakeDeps(), () => "user-1");
    const res = await app.request("/episodes/ep-nope");
    expect(res.status).toBe(404);
  });

  it("creates episode from transcript (POST /episodes/new) → 202 with job", async () => {
    const created: Array<{ userId: string; transcriptId: string; polishId: string; title: string | null }> = [];
    const enqueued: Array<{ id: string; episodeId: string }> = [];
    const deps = fakeDeps({
      createEpisode: async (row) => {
        created.push(row);
        return { id: "ep-1" };
      },
      enqueueJob: async (job) => { enqueued.push(job); },
    });
    const app = episodesRoutes(deps, () => "user-1");
    const res = await app.request("/episodes/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcriptId: "t-1", title: "新节目" }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ episodeId: "ep-1", jobId: "job-1", status: "queued" });
    // 节目元数据落库：hostId=频道主人、subtitle=脚本去标签纯文本、topic/tags/snapshotId/guestId 继承
    expect(created).toEqual([{
      userId: "user-1",
      transcriptId: "t-1",
      polishId: "p-1",
      title: "新节目",
      description: null,
      snapshotId: null,
      topic: null,
      tags: null,
      subtitle: "你好",
      hostId: "user-1",
      guestId: null,
    }]);
    expect(enqueued).toEqual([{ id: "job-1", episodeId: "ep-1" }]);
  });

  it("episodes/new rejects missing or unknown transcript", async () => {
    const app = episodesRoutes(fakeDeps(), () => "user-1");
    const missing = await app.request("/episodes/new", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const unknown = await app.request("/episodes/new", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcriptId: "t-nope" }),
    });
    expect(unknown.status).toBe(404);
  });

  it("episodes/new 409 when script already generated an episode", async () => {
    const app = episodesRoutes(
      fakeDeps({
        getEpisodeByTranscript: async () => ({ id: "ep-existing" }),
      }),
      () => "user-1",
    );
    const res = await app.request("/episodes/new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcriptId: "t-1" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; episodeId?: string };
    expect(body.error).toBe("script_used");
    expect(body.episodeId).toBe("ep-existing");
  });

  it("episodes/new returns 422 when safety check rejects", async () => {
    const deps = fakeDeps({ safetyCheck: async () => ({ pass: false, reason: "违规内容" }) });
    const app = episodesRoutes(deps, () => "user-1");
    const res = await app.request("/episodes/new", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcriptId: "t-1" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "safety_rejected", reason: "违规内容" });
  });

  it("episodes/new returns 403 channel_not_active when channel inactive", async () => {
    const deps = fakeDeps({ getChannelActive: async () => false });
    const app = episodesRoutes(deps, () => "user-1");
    const res = await app.request("/episodes/new", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcriptId: "t-1" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_active" });
  });

  it("episodes/new returns 403 quota_exceeded when quota exhausted", async () => {
    const deps = fakeDeps({ getQuota: async () => ({ plan: "free", generatedCount: 5, creditBalance: 0 }) });
    const app = episodesRoutes(deps, () => "user-1");
    const res = await app.request("/episodes/new", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcriptId: "t-1" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "quota_exceeded" });
  });

  it("publishes episode", async () => {
    const app = episodesRoutes(fakeDeps(), () => "user-1");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("streams audio when episode has audio (GET /episodes/:id/audio)", async () => {
    const deps = fakeDeps({ getEpisodeAudio: async () => "audio/episodes/ep-1.mp3" });
    const storage = {
      get: async (key: string) => new Uint8Array([0x49, 0x44, 0x33, 0x01]), // "ID3" 音频头
    };
    const app = episodesRoutes(deps, () => "user-1", storage);
    const res = await app.request("/episodes/ep-1/audio");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual([0x49, 0x44, 0x33, 0x01]);
  });

  it("returns 404 for audio when episode has no audio yet", async () => {
    const app = episodesRoutes(fakeDeps(), () => "user-1", { get: async () => new Uint8Array() });
    const res = await app.request("/episodes/ep-1/audio");
    expect(res.status).toBe(404);
  });

  it("returns 404 for audio when storage read fails", async () => {
    const deps = fakeDeps({ getEpisodeAudio: async () => "audio/episodes/missing.mp3" });
    const app = episodesRoutes(deps, () => "user-1", {
      get: async () => { throw new Error("ENOENT"); },
    });
    const res = await app.request("/episodes/ep-1/audio");
    expect(res.status).toBe(404);
  });
});

describe("ownership scoping", () => {
  it("does not expose another user's episode", async () => {
    const app = episodesRoutes(fakeDeps(), () => "other-user");
    const res = await app.request("/episodes/ep-1");
    expect(res.status).toBe(404);
  });
  it("does not publish another user's episode", async () => {
    const app = episodesRoutes(fakeDeps(), () => "other-user");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(404);
  });
  it("does not create episode from another user's transcript", async () => {
    const app = episodesRoutes(fakeDeps(), () => "other-user");
    const res = await app.request("/episodes/new", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcriptId: "t-1" }),
    });
    expect(res.status).toBe(404);
  });
  it("publish returns 403 channel_not_active when channel inactive", async () => {
    const deps = fakeDeps({ getChannelActivatedAt: async () => null });
    const app = episodesRoutes(deps, () => "user-1");
    const res = await app.request("/episodes/ep-1/publish", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_active" });
  });
});
