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
});
