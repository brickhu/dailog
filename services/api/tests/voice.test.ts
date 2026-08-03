import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { voiceRoutes, type VoiceDeps } from "../src/routes/voice";

function makeVoice(deps: Partial<VoiceDeps> = {}) {
  return voiceRoutes({
    saveVoiceSample: async () => {},
    getVoiceSample: async () => null,
    tts: { createVoiceModel: async () => ({ id: "voice-1" }), synthesizeMultiSpeaker: vi.fn(), synthesizeSingle: vi.fn() } as never,
    storage: { put: async () => {}, get: vi.fn() } as never,
    ...deps,
  });
}

describe("GET /api/me/voice-sample", () => {
  it("returns 404 when user has no sample", async () => {
    const app = makeVoice({ getVoiceSample: async () => null });
    const res = await app.request("/api/me/voice-sample");
    expect(res.status).toBe(404);
  });

  it("returns latest sample for onboarding guard", async () => {
    const app = makeVoice({
      getVoiceSample: async () => ({
        userId: "user-1",
        audioUrl: "audio/voices/user-1.wav",
        referenceId: "voice-1",
        duration: 15,
        status: "ready",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      }),
    });
    const res = await app.request("/api/me/voice-sample");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ status: "ready", referenceId: "voice-1", duration: 15 });
    expect(json.createdAt).toBeDefined();
  });
});

describe("POST /api/me/voice-sample", () => {
  it("stores sample and creates voice model", async () => {
    const saveVoiceSample = vi.fn(async () => {});
    const storagePut = vi.fn(async () => {});
    const createVoiceModel = vi.fn(async () => ({ id: "voice-1" }));
    const app = makeVoice({
      saveVoiceSample,
      storage: { put: storagePut, get: vi.fn() } as never,
      tts: { createVoiceModel: createVoiceModel as never, synthesizeMultiSpeaker: vi.fn(), synthesizeSingle: vi.fn() } as never,
    });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "voice.wav");
    const res = await app.request("/api/me/voice-sample", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.referenceId).toBe("voice-1");
    expect(storagePut).toHaveBeenCalled();
    expect(saveVoiceSample).toHaveBeenCalledWith(expect.objectContaining({ referenceId: "voice-1" }));
  });

  it("returns 400 when file missing", async () => {
    const app = makeVoice();
    const res = await app.request("/api/me/voice-sample", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });

  it("returns 503 when tts not configured", async () => {
    const app = makeVoice({
      tts: null as never, // 未配置
    });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1])]), "voice.wav");
    const res = await app.request("/api/me/voice-sample", { method: "POST", body: form });
    expect(res.status).toBe(503);
  });
});
