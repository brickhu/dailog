import { describe, expect, it, vi } from "vitest";
import { polishRoutes, type PolishDeps } from "../src/routes/polish";

function makePolish(deps: Partial<PolishDeps> = {}) {
  return polishRoutes({
    getDialogueMessages: async () => [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！" },
    ],
    qualityCheck: async () => ({ pass: true, language: "zh" }),
    savePolished: async (_ep, _lang, segments) => ({ version: 2, segments }),
    llm: { complete: async () => "", stream: async () => "" },
    getPolishCount: async () => 0,
    getPolishLimit: async () => 5,
    ...deps,
  });
}

describe("POST /api/episodes/:id/polish", () => {
  it("returns 422 when quality check rejects", async () => {
    const app = makePolish({ qualityCheck: async () => ({ pass: false, reason: "too_short" }) });
    const res = await app.request("/api/episodes/ep-1/polish", { method: "POST" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "quality_rejected", reason: "too_short" });
  });

  it("streams SSE and saves polished script", async () => {
    const savePolished = vi.fn(async () => ({ version: 2, segments: [] }));
    const app = makePolish({
      savePolished,
      llm: {
        complete: async () => "",
        stream: async (_msgs, onDelta) => {
          onDelta('[{"speaker":"host","text":"你好"}');
          onDelta(',{"speaker":"guest","text":"你好！"}]');
          return '[{"speaker":"host","text":"你好"},{"speaker":"guest","text":"你好！"}]';
        },
      },
    });
    const res = await app.request("/api/episodes/ep-1/polish", { method: "POST" });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: segment");
    expect(savePolished).toHaveBeenCalled();
  });

  it("returns 429 when dialogue polish count reached limit", async () => {
    const app = makePolish({
      getPolishCount: async () => 5, // 已达上限
      getPolishLimit: async () => 5,
    });
    const res = await app.request("/api/episodes/ep-1/polish", { method: "POST" });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "polish_limit_reached" });
  });

  it("passes instruction into polish prompt (direction)", async () => {
    const stream = vi.fn(async (_msgs: unknown, _onDelta?: (d: string) => void) => '[{"speaker":"host","text":"x"}]');
    const app = makePolish({
      llm: { complete: async () => "", stream: stream as never },
    });
    await app.request("/api/episodes/ep-1/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "更简短一些" }),
    });
    const [messages] = stream.mock.calls[0];
    const system = (messages as Array<{ role: string; content: string }>)[0].content;
    expect(system).toContain("更简短一些");
  });

  it("ignores empty or oversized instruction", async () => {
    const stream = vi.fn(async (_msgs: unknown, _onDelta?: (d: string) => void) => '[{"speaker":"host","text":"x"}]');
    const app = makePolish({
      llm: { complete: async () => "", stream: stream as never },
    });
    await app.request("/api/episodes/ep-1/polish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instruction: "   " }), // 纯空白 → 不拼入
    });
    const [messages] = stream.mock.calls[0];
    const system = (messages as Array<{ role: string; content: string }>)[0].content;
    expect(system).not.toContain("用户方向指示");
  });
});
