import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { voiceRoutes, type VoiceDeps } from "../src/routes/voice";

function makeVoice(deps: Partial<VoiceDeps> = {}) {
  // 模拟认证中间件注入 userId（真实链路由 app.ts 的 /api/* 鉴权中间件设置）
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  app.route("/", voiceRoutes({
    saveVoiceSample: async () => {},
    getVoiceSample: async () => null,
    storage: { put: async () => {}, get: vi.fn() } as never,
    ...deps,
  }));
  return app;
}

describe("GET /api/me/voice-sample", () => {
  it("returns 404 when user has no sample", async () => {
    const app = makeVoice({ getVoiceSample: async () => null });
    const res = await app.request("/v1/me/voice-sample");
    expect(res.status).toBe(404);
  });

  it("returns latest sample for onboarding guard", async () => {
    const app = makeVoice({
      getVoiceSample: async () => ({
        userId: "user-1",
        language: "zh",
        audioUrl: "voices/user-1.webm",
        transcript: "大家好，我是测试录音。",
        duration: 15,
        status: "ready",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    });
    const res = await app.request("/v1/me/voice-sample");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "ready", duration: 15 });
    expect(json.createdAt).toBeDefined();
  });
});

describe("POST /api/me/voice-sample（样本直传：只保存，不训练）", () => {
  it("stores sample file and marks ready without training", async () => {
    const saveVoiceSample = vi.fn(async () => {});
    const storagePut = vi.fn(async (_key: string, _data: Uint8Array) => {});
    const app = makeVoice({
      saveVoiceSample,
      storage: { put: storagePut, get: vi.fn() } as never,
    });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "voice.wav");
    const res = await app.request("/v1/me/voice-sample", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    const call = storagePut.mock.calls[0];
    expect(call[0]).toBe("voices/user-1/zh.webm");
    expect(call[1]).toEqual(new Uint8Array([1, 2, 3])); // Uint8Array 按值深度比较
    expect(saveVoiceSample).toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: "voices/user-1/zh.webm", language: "zh", transcript: null, status: "ready" }),
    );
  });

  it("returns 400 when file missing", async () => {
    const app = makeVoice();
    const res = await app.request("/v1/me/voice-sample", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });
});
