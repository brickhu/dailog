import { describe, expect, it, vi } from "vitest";
import { generateRoutes, type GenerateDeps } from "../src/routes/generate";

function makeGenerate(deps: Partial<GenerateDeps> = {}) {
  return generateRoutes({
    getOwnedEpisode: async () => ({ id: "ep-1" }),
    getLatestScript: async () => ({ version: 2, segments: [{ speaker: "host", text: "你好" }] }),
    safetyCheck: async () => ({ pass: true }),
    getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
    consumeQuota: async () => {},
    createJob: async (episodeId) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
    enqueueJob: async () => {},
    ...deps,
  });
}

describe("POST /api/episodes/:id/generate", () => {
  it("creates job and returns 202 when gates pass", async () => {
    const enqueueJob = vi.fn(async () => {});
    const app = makeGenerate({ enqueueJob });
    const res = await app.request("/api/episodes/ep-1/generate", { method: "POST" });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.jobId).toBe("job-1");
    expect(enqueueJob).toHaveBeenCalledWith({ id: "job-1", episodeId: "ep-1" });
  });

  it("returns 422 when safety check rejects (no job, no quota)", async () => {
    const consumeQuota = vi.fn(async () => {});
    const createJob = vi.fn(async () => ({ id: "job-x", episodeId: "ep-1", status: "queued", progress: 0 }));
    const app = makeGenerate({
      safetyCheck: async () => ({ pass: false, reason: "harmful_content" }),
      consumeQuota,
      createJob: createJob as never,
    });
    const res = await app.request("/api/episodes/ep-1/generate", { method: "POST" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "safety_rejected", reason: "harmful_content" });
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("returns 403 when quota insufficient", async () => {
    const app = makeGenerate({ getQuota: async () => ({ plan: "free", generatedCount: 1, creditBalance: 0 }) });
    const res = await app.request("/api/episodes/ep-1/generate", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "quota_exceeded" });
  });

  it("returns 404 when no script", async () => {
    const app = makeGenerate({ getLatestScript: async () => null });
    const res = await app.request("/api/episodes/ep-1/generate", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("ownership", () => {
  it("returns 404 for another user's episode", async () => {
    const app = makeGenerate({ getOwnedEpisode: async () => null });
    const res = await app.request("/api/episodes/ep-other/generate", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
