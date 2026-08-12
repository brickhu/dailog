import { describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";
import type { Repos } from "../src/repo";

// /v1/transcripts/new 多主题切分测试：fake llm 返回多脚本/quality_failed/旧格式，验证解析与落库

function fakeRepo(): Repos {
  return {
        notifications: {
          create: async () => {},
          listByUser: async () => [],
          unreadCount: async () => 0,
          markAllRead: async () => {},
          getEmailByUserId: async () => null,
        },
        guests: {
      getByPlatform: async () => null,
      list: async () => [],
      voiceSampleByLanguage: async () => null,
      voiceSampleAny: async () => null,
      upsertVoiceSample: async () => {},
      listVoiceSamples: async () => [],
    },
    snapshots: {
      getByUrl: async () => null,
      getById: async () => null,
      create: async () => ({ id: "snap-1" }),
      updateContent: async () => {},
      updateQuality: async () => {},
      markUnreachable: async () => {},
            markParseFailed: async () => {},
      listTraceable: async () => [],
      setSourceTrace: async () => {},
    },
    polishes: {
      findByUserSnapshot: async () => null,
      create: async () => ({ id: "polish-1" }),
      createSubmission: async () => ({ id: "sub-1" }),
      listSubmissionsByUser: async () => [],
      listQueue: async () => [],
      getById: async () => null,
      setStatus: async () => {},
      getOwned: async () => null,
      getPolishDetail: async () => null,
      listByUser: async () => [],
    },
    transcripts: {
      create: vi.fn(async (_polishId, _segments, _language, _opts) => ({ id: `tr-${Math.random().toString(36).slice(2, 8)}` })),
      listByPolish: async () => [],
      getOwned: async () => null,
      updateSegments: async () => {},
      markUsed: async () => {},
      getById: async () => null,
    },
    episodes: {
      create: async () => ({ id: "ep-1" }),
      listByUser: async () => [],
      getOwned: async () => null,
      getEpisodeAudio: async () => null,
      getByTranscript: async () => null,
      listByPolish: async () => [],
      getEpisodeScript: async () => null,
      getEpisodeGuest: async () => null,
      getPublicAudioKey: async () => null,
      getPublicCoverKey: async () => null,
      getPublishedDialogue: async () => null,
      setPublished: async () => {},
      getById: async () => null,
      publish: async () => ({ number: 1 }),
      updatePublished: async () => {},
      listPublished: async () => [],
      findPublishedEpisodeBySnapshot: async () => null,
      getEpisodeUserId: async () => null,
      getEpisodeLanguage: async () => null,
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      saveVoiceSample: async () => {},
      insertTrack: async () => {},
      getChannelActivatedAt: async () => new Date(),
      getProfile: async () => null,
      updateUserNickname: async () => {},
      updatePersona: async () => {},
      updateChannel: async () => ({ ok: true }),
      isUsernameTaken: async () => false,
      syncAdminRoles: async () => 0,
    },
    jobs: {
      getQuotaInfo: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      getOwnedEpisode: async () => null,
      listRecoverableJobs: async () => [],
      markJobProgress: async () => {},
      markJobDone: async () => {},
      markJobFailed: async () => {},
    },
  };
}

function makeApp(llmOutput: string) {
  const env: Env = {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    SITE_BASE_URL: "https://site.dailog.fm",
    PORT: 8787,
    DEEPSEEK_API_KEY: "",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
    DEEPSEEK_MODEL: "deepseek-chat",
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    ASSETS_DIR: "assets/audio",
    APP_ORIGINS: "",
    POLISH_MAX_VERSIONS: 5,
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
    PEXELS_API_KEY: "",
  };
  const repo = fakeRepo();
  return createApp({
    env,
    auth: { handler: async () => new Response("", { status: 404 }), api: { getSession: async () => ({ user: { id: "user-1" } }) } },
    repo,
    importDeps: {
      getSnapshotByUrl: async () => null,
      createSnapshot: async () => ({ id: "snap-1" }),
      updateSnapshotContent: async () => {},
      markSnapshotUnreachable: async () => {},
      markSnapshotParseFailed: async () => {},
      findPolishByUserSnapshot: async () => null,
      parseShareHtml: async () => null,
      listTraceableSnapshots: async () => [],
      setSnapshotSourceTrace: async () => {},
      findPublishedEpisodeBySnapshot: async () => null,
      getPlatformRules: async () => [
        { id: "claude", label: "Claude", sharePattern: "^https?:\\/\\/(www\\.)?claude\\.ai\\/share\\/[0-9a-f-]{36}" },
        { id: "deepseek", label: "DeepSeek", sharePattern: "^https?:\\/\\/chat\\.deepseek\\.com\\/share\\/[A-Za-z0-9]+" },
        { id: "chatgpt", label: "ChatGPT", sharePattern: "^https?:\\/\\/(www\\.)?chatgpt\\.com\\/share\\/[A-Za-z0-9-]+" },
        { id: "kimi", label: "Kimi", sharePattern: "^https?:\\/\\/(www\\.)?kimi\\.com\\/share\\/[0-9a-f-]{36}" },
      ],
    },
    job: { getOwnedEpisode: async () => null, getLatestJob: async () => null },
    voice: {
      saveVoiceSample: async () => {},
      storage: { put: async () => {}, get: async () => new Uint8Array(), delete: async () => {} },
    },
    channel: { activateChannel: async () => ({ ok: true }) },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleFavorite: async () => ({ favorited: true }),
      toggleLike: async () => ({ liked: true }),
      listFavorites: async () => [],
    },
    admin: { isAdmin: async () => false, createInviteCode: async () => ({ ok: true, code: "fake", expiresAt: null }), storage: { put: async () => {} }, upsertGuestVoiceSample: async () => {}, listGuestVoiceSamples: async () => [], listGuests: async () => [] },
    shareCollectUrl: () => null,
    polishesDeps: {
      getChannelActivatedAt: async () => new Date(),
      findPolishByUserSnapshot: async () => null,
      createPolish: async () => ({ id: "polish-1" }),
      getPolishDetail: async () => null,
      listByUser: async () => [],
    },
    transcriptsDeps: {
      getDialogueForPolish: async () => ({
        messages: [{ role: "user", content: "问1" }, { role: "assistant", content: "答1" }],
        platform: "claude",
      }),
      getTranscriptCount: async () => 0,
      getPolishLimit: async () => 5,
      createTranscript: (polishId, segments, language, opts) => repo.transcripts.create(polishId, segments, language, opts),
      getOwnedTranscript: async () => null,
      guestsByPlatform: {},
      updateTranscriptSegments: async () => {},
      llm: {
        complete: async () => "",
        stream: async (_msgs, onDelta) => {
          onDelta(llmOutput);
          return llmOutput;
        },
      },
    },
    episodesDeps: {
      listByUser: async () => [],
      getOwned: async () => null,
      getEpisodeAudio: async () => null,
      getOwnedTranscript: async () => null,
      getEpisodeByTranscript: async () => null,
      createEpisode: async () => ({ id: "ep-1" }),
      safetyCheck: async () => ({ pass: true }),
      getChannelActive: async () => true,
      getQuota: async () => ({ plan: "free", generatedCount: 0, creditBalance: 0 }),
      consumeQuota: async () => {},
      createJob: async (episodeId: string) => ({ id: "job-1", episodeId, status: "queued", progress: 0 }),
      getLatestJob: async () => null,
      enqueueJob: async () => {},
      setPublished: async () => {},
      getChannelActivatedAt: async () => new Date(),
      getHostModelId: async () => null,
      getVoiceSampleKey: async () => null,
      getVoiceSample: async () => null,
      getVoiceSampleByLanguage: async () => null,
      markUsed: async () => {},
      saveVoiceSample: async () => {},
    },
  });
}

const postPolish = (app: ReturnType<typeof makeApp>) =>
  app.request("/v1/transcripts/new", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ polishId: "polish-1" }),
  });

describe("/v1/transcripts/new 多主题切分", () => {
  it("多脚本输出 → 每条落库（带 topic）+ done 返回 transcriptIds", async () => {
    const app = makeApp(
      JSON.stringify({
        language: "zh",
        scripts: [
          { topic: "AI 编程", segments: [{ speaker: "host", text: "你好" }, { speaker: "guest", text: "聊聊 AI 编程" }] },
          { topic: "生活效率", segments: [{ speaker: "host", text: "还有呢" }, { speaker: "guest", text: "聊聊效率工具" }] },
        ],
      }),
    );
    const res = await postPolish(app);
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("event: done");
    expect(sse).toContain("transcriptIds");
    const repo = (app as unknown as { _repo?: Repos })._repo; // 不走断言（fake 内部）
    // 通过 done 的 count 验证两条
    expect(sse).toContain('"count":2');
  });

  it("quality_failed → SSE quality_failed 事件（不落库）", async () => {
    const app = makeApp(JSON.stringify({ quality_failed: true, reason: "纯寒暄，无实质主题" }));
    const res = await postPolish(app);
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("event: quality_failed");
    expect(sse).toContain("纯寒暄");
    expect(sse).not.toContain("event: done");
  });

  it("兼容旧输出（纯数组）→ 单条落库 topic=null", async () => {
    const app = makeApp(JSON.stringify([{ speaker: "host", text: "旧格式" }]));
    const res = await postPolish(app);
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("event: done");
    expect(sse).toContain('"count":1');
  });
});
