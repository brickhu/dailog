import { describe, expect, it, vi } from "vitest";
import { createJobQueue, type JobHandler } from "../src/pipeline/queue";

describe("createJobQueue", () => {
  it("processes jobs serially with progress", async () => {
    const handler = vi.fn<JobHandler>(async (job, update) => {
      await update(50);
      await update(100);
      return { status: "done" };
    });
    const queue = createJobQueue(handler, { concurrency: 1, maxAttempts: 1, backoffMs: 5 });
    const updates: number[] = [];
    const done = queue.enqueue({ id: "j1", episodeId: "e1" }, (p) => updates.push(p));
    await done;
    expect(updates).toEqual([50, 100]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("retries on failure up to maxAttempts with backoff", async () => {
    const handler = vi.fn<JobHandler>(async () => { throw new Error("boom"); });
    const queue = createJobQueue(handler, { concurrency: 1, maxAttempts: 3, backoffMs: 5 });
    const result = await queue.enqueue({ id: "j2", episodeId: "e2" }, () => {});
    expect(handler).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("boom");
  });
});
