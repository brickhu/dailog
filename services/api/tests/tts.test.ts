import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { ttsRoutes, type TtsDeps } from "../src/routes/tts";
import type { AuthEnv } from "../src/middleware/auth";
import type { Repos } from "../src/repo";

// 统一 TTS 端点测试：编辑本地不直连 Fish——端点做「采样/声线 → 转码 → Fish 合成 → mp3」。
// fish 客户端 mock；ffmpeg 用真实二进制（@ffmpeg-installer）转码测试音频。

function fakeRepo(overrides: Partial<Repos> = {}): Repos {
  return {
    guests: {
      getByPlatform: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      update: async () => {},
      listVoiceSamples: async () => [],
    },
    notifications: {
      create: async () => {},
      listByUser: async () => [],
      unreadCount: async () => 0,
      markAllRead: async () => {},
      getEmailByUserId: async () => null,
      existsAfter: async () => false,
      existsByLink: async () => false,
    },
    episodes: {
      createPublished: async () => ({ id: "ep-1", number: 1 }),
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getById: async () => null,
      updatePublished: async () => {},
      listPublished: async () => [],
      listBySubmission: async () => [],
      getEpisodeUserId: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      getVoiceSampleKey: async () => null,
      saveVoiceSample: async () => {},
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updatePersona: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      isUsernameTaken: async () => false,
      syncAdminRoles: async () => 0,
    },
    submissions: {
      create: async () => ({ id: "sub-1" }),
      findByUserUrl: async () => null,
      countPendingByUser: async () => 0,
      listByUser: async () => [],
      listQueue: async () => [],
      getDetail: async () => null,
      reject: async () => {},
      markPublished: async () => {},
    },
    ...overrides,
  };
}

/** 生成一段合法 wav（ffmpeg 正弦音）作为参考音频 */
function makeTestWav(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "tts-test-"));
  const out = join(dir, "tone.wav");
  execFileSync(ffmpegInstaller.path, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=44100", "-ac", "1", out], { stdio: "ignore" });
  const bytes = new Uint8Array(readFileSync(out));
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

function makeApp(deps: Partial<TtsDeps> = {}, role: "user" | "editor" | "admin" = "editor") {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", "editor-1");
    c.set("role", role);
    await next();
  });
  app.route("/", ttsRoutes({
    repo: fakeRepo(),
    storage: { get: async () => new Uint8Array() },
    ffmpegPath: ffmpegInstaller.path,
    fish: {
      synthesizeSingle: async () => new Uint8Array([1, 2, 3]),
      synthesizeMultiSpeaker: async () => new Uint8Array(),
    },
    ...deps,
  }));
  return app;
}

const SUBMITTED_DETAIL = {
  id: "sub-1",
  userId: "user-1",
  url: "https://claude.ai/share/abc",
  title: null,
  status: "submitted" as const,
  rejectedReason: null,
  reviewedAt: null,
  createdAt: new Date(),
  userEmail: "submitter@test.local",
  displayName: "投稿人",
  voiceSample: { audioUrl: "voices/user-1/zh.webm", transcript: "大家好", language: "zh", status: "ready" },
};

describe("角色守卫", () => {
  it("普通用户 → 403", async () => {
    const res = await makeApp({}, "user").request("/v1/editor/tts", { method: "POST", body: new FormData() });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/editor/tts（统一 TTS 端点）", () => {
  it("服务端未配置 FISH_API_KEY → 503", async () => {
    const res = await makeApp({ fish: null }).request("/v1/editor/tts", { method: "POST", body: new FormData() });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "tts_not_configured" });
  });

  it("text 缺失 → 400", async () => {
    const form = new FormData();
    form.append("submissionId", "sub-1");
    const res = await makeApp().request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "text_required" });
  });

  it("host：投稿人无采样 → 422", async () => {
    const app = makeApp({ repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL } }) });
    const form = new FormData();
    form.append("submissionId", "sub-1");
    form.append("text", "大家好");
    form.append("speaker", "host");
    const res = await app.request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "no_voice_sample" });
  });

  it("host：服务端取采样（storage + transcript）→ 合成 → mp3", async () => {
    const wav = makeTestWav();
    const synthesizeSingle = vi.fn(async () => new Uint8Array([9, 9, 9]));
    const app = makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL },
        episodes: {
          ...fakeRepo().episodes,
          getVoiceSampleByLanguage: async () => ({ userId: "user-1", language: "zh", audioUrl: "voices/user-1/zh.webm", transcript: "大家好", duration: 5, status: "ready" }),
        },
      }),
      storage: { get: async () => wav },
      fish: { synthesizeSingle, synthesizeMultiSpeaker: async () => new Uint8Array() },
    });
    const form = new FormData();
    form.append("submissionId", "sub-1");
    form.append("text", "欢迎大家收听");
    form.append("speaker", "host");
    form.append("language", "zh");
    const res = await app.request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("audio/mpeg");
    expect(await res.arrayBuffer()).toEqual(new Uint8Array([9, 9, 9]).buffer);
    // Fish 收到的是转码后的 wav + 采样 transcript
    expect(synthesizeSingle).toHaveBeenCalledWith(expect.objectContaining({ text: "欢迎大家收听", referenceAudioTranscript: "大家好" }));
  });

  it("guest：服务端取声线（guest_voice_samples + R2）→ 合成", async () => {
    const wav = makeTestWav();
    const synthesizeSingle = vi.fn(async () => new Uint8Array([1]));
    const app = makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL },
        guests: {
          ...fakeRepo().guests,
          voiceSampleByLanguage: async () => ({ id: "gvs-1", guestId: "claude", language: "zh", audioKey: "guests/claude/zh.mp3", referenceId: null, transcript: "声线朗读文案" }),
        },
      }),
      storage: { get: async () => wav },
      fish: { synthesizeSingle, synthesizeMultiSpeaker: async () => new Uint8Array() },
    });
    const form = new FormData();
    form.append("submissionId", "sub-1");
    form.append("text", "我是嘉宾");
    form.append("speaker", "guest");
    form.append("guestId", "claude");
    form.append("language", "zh");
    const res = await app.request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(synthesizeSingle).toHaveBeenCalledWith(expect.objectContaining({ text: "我是嘉宾", referenceAudioTranscript: "声线朗读文案" }));
  });

  it("guest：缺 guestId → 400", async () => {
    const app = makeApp({ repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL } }) });
    const form = new FormData();
    form.append("submissionId", "sub-1");
    form.append("text", "我是嘉宾");
    form.append("speaker", "guest");
    const res = await app.request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "guest_required" });
  });

  it("guest：服务端未配置声线 → 422", async () => {
    const app = makeApp({
      repo: fakeRepo({ submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL } }),
    });
    const form = new FormData();
    form.append("submissionId", "sub-1");
    form.append("text", "我是嘉宾");
    form.append("speaker", "guest");
    form.append("guestId", "claude");
    const res = await app.request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "no_guest_voice" });
  });

  it("投稿不存在 → 404", async () => {
    const form = new FormData();
    form.append("submissionId", "missing");
    form.append("text", "测试");
    const res = await makeApp().request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(404);
  });

  it("非法参考音频 → 422（ffmpeg 转码失败）", async () => {
    const app = makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL },
        episodes: {
          ...fakeRepo().episodes,
          getVoiceSampleByLanguage: async () => ({ userId: "user-1", language: "zh", audioUrl: "voices/user-1/zh.webm", transcript: "大家好", duration: 5, status: "ready" }),
        },
      }),
      storage: { get: async () => new Uint8Array([0, 1, 2, 3]) }, // 非法音频字节
    });
    const form = new FormData();
    form.append("submissionId", "sub-1");
    form.append("text", "测试");
    form.append("speaker", "host");
    const res = await app.request("/v1/editor/tts", { method: "POST", body: form });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "audio_decode_failed" });
  });
});
