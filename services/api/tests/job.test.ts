import { describe, expect, it, vi } from "vitest";
import { jobRoutes, type JobDeps } from "../src/routes/job";

function makeJob(deps: Partial<JobDeps> = {}) {
  return jobRoutes({
    getLatestJob: async () => ({ id: "job-1", status: "queued", progress: 0, error: null }),
    ...deps,
  });
}

describe("GET /api/episodes/:id/job", () => {
  it("returns latest job with status/progress/error", async () => {
    const getLatestJob = vi.fn(async () => ({ id: "job-9", status: "tts", progress: 30, error: null }));
    const app = makeJob({ getLatestJob });
    const res = await app.request("/api/episodes/ep-1/job");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "job-9", status: "tts", progress: 30, error: null });
    expect(getLatestJob).toHaveBeenCalledWith("ep-1");
  });

  it("surfaces failed job error text", async () => {
    const app = makeJob({ getLatestJob: async () => ({ id: "job-f", status: "failed", progress: 40, error: "tts_timeout" }) });
    const res = await app.request("/api/episodes/ep-1/job");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "failed", error: "tts_timeout" });
  });

  it("returns 404 when no job exists", async () => {
    const app = makeJob({ getLatestJob: async () => null });
    const res = await app.request("/api/episodes/ep-1/job");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
