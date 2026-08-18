import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { ttsRoutes, type TtsDeps } from "../src/routes/tts";
import { fakePlaylistsRepo } from "./helpers/fake-playlists";
import type { AuthEnv } from "../src/middleware/auth";
import type { Repos } from "../src/repo";

// 统一 TTS 端点测试（multi speaker）：JSON 完整脚本 → 服务端组装
// <|speaker:N|> 标签 + references 2D（官方多说话人接口）→ 整集 mp3。
// fish 客户端 mock；ffmpeg 用真实二进制（@ffmpeg-installer）转码测试音频。

function fakeRepo(overrides: Partial<Repos> = {}): Repos {
  return {
    guests: {
      getByPlatform: async () => null,
      getById: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      update: async () => {},
      listVoiceSamples: async () => [],
    },
    playlists: fakePlaylistsRepo(),
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
      createPublished: async () => ({ id: "ep-1", number: 1, slug: "abc12345" }),
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getPublicEpisode: async () => null,
      getById: async () => null,
      updatePublished: async () => {},
      listPublished: async () => [],
      listBySubmission: async () => [],
      listByGuest: async () => [],
      getEpisodeUserId: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      getVoiceSampleKey: async () => null,
      saveVoiceSample: async () => ({ id: "" }),
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updateChannel: async () => ({ ok: true } as const),
      syncAdminRoles: async () => 0,
      recordStat: async () => {},
      getStats: async () => ({ plays: 0, completions: 0, likes: 0, favorites: 0 }),
      listRecommended: async () => [],
      listTopHosts: async () => [],
      getSiteStats: async () => ({ hostCount: 0, guestCount: 0, episodeCount: 0, topHost: null, topHostAvatar: null, topTags: [] }),
      getPersonaSnapshot: async () => ({ displayName: "测试员", gender: null, profession: null, age: null, bio: null, nationality: null }),
      listByUser: async () => [],
      setPublic: async () => 0,
    },
    submissions: {
      create: async () => ({ id: "sub-1" }),
      findByUrl: async () => null,
      findById: async () => null,
      countPendingByUser: async () => 0,
      hasReadyVoiceSample: async () => true,
      listByUser: async () => [],
      getPublicById: async () => null,
      getByUser: async () => null,
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
    storage: { get: async () => ({ data: new Uint8Array(), total: 0 }), put: async () => {}, delete: async () => {} },
    ffmpegPath: ffmpegInstaller.path,
    fish: {
      synthesizeSingle: async () => new Uint8Array([1, 2, 3]),
      synthesizeMultiSpeaker: async () => new Uint8Array([9, 9, 9]),
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
  personaInfo: { displayName: "投稿人", gender: null, profession: null, age: null, bio: null, nationality: null },
  callName: "小北",
  suggestion: null,
  voiceSampleId: null,
  voiceSamples: [{ audioUrl: "voices/user-1/zh.webm", transcript: "大家好", language: "zh", status: "ready", duration: 5 }],
};

const SEGMENTS = [
  { speaker: "host", text: "大家好，欢迎收听 dailog。" },
  { speaker: "guest", text: "很高兴回到这里。" },
  { speaker: "host", text: "今天聊聊 AI 编程。" },
];

function baseDeps(): Partial<TtsDeps> {
  const wav = makeTestWav();
  return {
    repo: fakeRepo({
      submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL },
      episodes: {
        ...fakeRepo().episodes,
        getVoiceSampleByLanguage: async () => ({ userId: "user-1", language: "zh", audioUrl: "voices/user-1/zh.webm", transcript: "大家好", duration: 5, status: "ready" }),
      },
      guests: {
        ...fakeRepo().guests,
        voiceSampleByLanguage: async () => ({ id: "gvs-1", guestId: "claude", language: "zh", audioKey: "guests/claude/zh.mp3", referenceId: null, transcript: "声线文案" }),
      },
    }),
    storage: { get: async () => ({ data: wav, total: wav.length }), put: async () => {}, delete: async () => {} },
    fish: {
      synthesizeSingle: async () => new Uint8Array([1]),
      synthesizeMultiSpeaker: async () => new Uint8Array([9, 9, 9]),
    },
  };
}

function postJson(app: ReturnType<typeof makeApp>, body: unknown) {
  return app.request("/v1/editor/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("角色守卫", () => {
  it("普通用户 → 403", async () => {
    const res = await makeApp({}, "user").request("/v1/editor/tts", { method: "POST", body: "{}" });
    expect(res.status).toBe(403);
  });
});

describe("POST /v1/editor/tts（multi speaker 整集合成）", () => {
  it("服务端未配置 FISH_API_KEY → 503", async () => {
    const res = await makeApp({ fish: null }).request("/v1/editor/tts", { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "tts_not_configured" });
  });

  it("segments 缺失 → 400", async () => {
    const res = await postJson(makeApp(baseDeps()), { submissionId: "sub-1", segments: [] });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "segments_required" });
  });

  it("含 guest 段但缺 guestId → 400", async () => {
    const res = await postJson(makeApp(baseDeps()), { submissionId: "sub-1", segments: SEGMENTS });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "guest_required" });
  });

  it("host+guest：multi speaker 一次合成（<|speaker:N|> 标签 + references 2D）→ 整集 mp3", async () => {
    const synthesizeMultiSpeaker = vi.fn(async () => new Uint8Array([9, 9, 9]));
    const synthesizeSingle = vi.fn(async () => new Uint8Array([1]));
    const app = makeApp({ ...baseDeps(), fish: { synthesizeSingle, synthesizeMultiSpeaker } });
    const res = await postJson(app, { submissionId: "sub-1", language: "zh", guestId: "claude", segments: SEGMENTS });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("audio/mpeg");
    expect(await res.arrayBuffer()).toEqual(new Uint8Array([9, 9, 9]).buffer);
    // multi speaker 组装断言：speaker 序号 + references 2D + 转录
    expect(synthesizeMultiSpeaker).toHaveBeenCalledWith(expect.objectContaining({
      segments: [
        { speaker: 0, text: "大家好，欢迎收听 dailog。" },
        { speaker: 1, text: "很高兴回到这里。" },
        { speaker: 0, text: "今天聊聊 AI 编程。" },
      ],
      referenceAudios: [expect.any(Uint8Array), expect.any(Uint8Array)],
      transcripts: ["大家好", "声线文案"],
    }));
    expect(synthesizeSingle).not.toHaveBeenCalled();
  });

  it("纯 host：single 整集（无 guest 标签）", async () => {
    const synthesizeSingle = vi.fn(async () => new Uint8Array([1]));
    const synthesizeMultiSpeaker = vi.fn(async () => new Uint8Array([9]));
    const app = makeApp({ ...baseDeps(), fish: { synthesizeSingle, synthesizeMultiSpeaker } });
    const res = await postJson(app, { submissionId: "sub-1", language: "zh", segments: [{ speaker: "host", text: "大家好" }] });
    expect(res.status).toBe(200);
    expect(synthesizeSingle).toHaveBeenCalledWith(expect.objectContaining({ text: "大家好", referenceAudioTranscript: "大家好" }));
    expect(synthesizeMultiSpeaker).not.toHaveBeenCalled();
  });

  it("guest 声线服务端未配置 → 422", async () => {
    const app = makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => SUBMITTED_DETAIL },
        episodes: { ...fakeRepo().episodes, getVoiceSampleByLanguage: async () => ({ userId: "user-1", language: "zh", audioUrl: "v", transcript: "t", duration: 5, status: "ready" }) },
      }),
      storage: { get: async () => ({ data: makeTestWav(), total: 5 }), put: async () => {}, delete: async () => {} },
    });
    const res = await postJson(app, { submissionId: "sub-1", guestId: "claude", segments: SEGMENTS });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "no_guest_voice" });
  });

  it("host 无采样 → 422", async () => {
    const app = makeApp({
      repo: fakeRepo({
        submissions: { ...fakeRepo().submissions, getDetail: async () => ({ ...SUBMITTED_DETAIL, voiceSamples: [] }) },
      }),
    });
    const res = await postJson(app, { submissionId: "sub-1", segments: [{ speaker: "host", text: "大家好" }] });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "no_voice_sample" });
  });

  it("投稿不存在 → 404", async () => {
    // 默认 fake 的 getDetail 返回 null（未覆盖）→ 404
    const res = await postJson(makeApp(), { submissionId: "missing", segments: [{ speaker: "host", text: "x" }] });
    expect(res.status).toBe(404);
  });

  it("非法 speaker → 400", async () => {
    const res = await postJson(makeApp(baseDeps()), { submissionId: "sub-1", segments: [{ speaker: "ai", text: "x" }] });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invalid_segment" });
  });
});
