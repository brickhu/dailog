import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "../src/app";
import type { Env } from "../src/config/env";
import type { AudioStorage } from "../src/storage";

// 音频端点回归：Range 分片下发。核心是「开放区间必须一次给到文件尾」——
// 旧实现每次只回 1MiB，一集要 8 次往返，任何一次挂住播放就永久停在分片边界
// （线上症状：总时长 5:23，播到 5:05 卡死且不报错）。

const TOTAL = 3 * 1024 * 1024 + 777; // 跨过旧的 1MiB 分片阈值
function fixture(): Uint8Array {
  const buf = new Uint8Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) buf[i] = i % 251;
  return buf;
}

function fakeStorage(data: Uint8Array): AudioStorage {
  return {
    put: async () => {},
    delete: async () => {},
    get: async (_key, range) => {
      if (!range) return { data, total: data.length };
      const end = Math.min(range.end, data.length - 1);
      return { data: data.subarray(range.start, end + 1), total: data.length };
    },
  };
}

function makeEnv(): Env {
  return {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    PORT: 8787,
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    APP_ORIGINS: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
    SITE_BASE_URL: "https://dailog.fm",
  } as Env;
}

const ID = "11111111-2222-4333-8444-555555555555";

function makeApp(storage: AudioStorage) {
  const repo = {
    playlists: {},
    notifications: {},
    guests: {},
    submissions: {},
    episodes: {
      getPublicAudioKey: async () => ({ audioKey: "episodes/u/1.mp3", version: "v1" }),
      getPublicCoverKey: async () => null,
    },
  } as unknown as AppDeps["repo"];
  return createApp({
    env: makeEnv(),
    auth: { handler: async () => new Response(), api: { getSession: async () => null } },
    repo,
    voice: { saveVoiceSample: async () => ({ id: "" }), storage },
    editor: { repo, env: makeEnv(), storage, siteBaseUrl: null },
    tts: { repo, storage, ffmpegPath: "/fake/ffmpeg", fish: null },
    favorites: {
      getPublishableEpisode: async () => null,
      toggleLike: async () => ({ liked: true, likes: 1 }),
      getInteractions: async () => ({ liked: false, likes: 0 }),
    },
  } as unknown as AppDeps);
}

describe("GET /v1/public/episodes/:id/audio（Range 下发）", () => {
  const data = fixture();
  const app = makeApp(fakeStorage(data));
  const url = `/v1/public/episodes/${ID}/audio`;

  it("开放区间 bytes=0- 一次回到文件尾（不再腰斩成 1MiB）", async () => {
    const res = await app.request(url, { headers: { Range: "bytes=0-" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-${TOTAL - 1}/${TOTAL}`);
    expect(res.headers.get("content-length")).toBe(String(TOTAL));
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(TOTAL);
  });

  it("尾部开放区间同样一次回完（播放到最后一段不会缺片）", async () => {
    const start = TOTAL - 4096;
    const res = await app.request(url, { headers: { Range: `bytes=${start}-` } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes ${start}-${TOTAL - 1}/${TOTAL}`);
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.length).toBe(4096);
    expect(body[0]).toBe(data[start]);
    expect(body[body.length - 1]).toBe(data[TOTAL - 1]);
  });

  it("明确区间按请求裁剪", async () => {
    const res = await app.request(url, { headers: { Range: "bytes=100-199" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 100-199/${TOTAL}`);
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(100);
  });

  it("越界区间 → 416 且带真实总长", async () => {
    const res = await app.request(url, { headers: { Range: `bytes=${TOTAL + 10}-` } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe(`bytes */${TOTAL}`);
  });

  it("非法区间（终点小于起点）按 RFC 忽略 Range → 200 全量", async () => {
    const res = await app.request(url, { headers: { Range: "bytes=500-100" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(TOTAL));
  });

  it("裸 URL 每次校验、带版本 URL 才长缓存（防坏副本/旧版本被钉住）", async () => {
    const plain = await app.request(url);
    expect(plain.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    const versioned = await app.request(url + "?v=1756732057754");
    expect(versioned.headers.get("cache-control")).toBe("public, max-age=604800, immutable");
    // 版本参数不影响内容
    expect(versioned.headers.get("content-length")).toBe(String(TOTAL));
  });

  it("无 Range → 200 全量 + ETag；If-None-Match 命中 → 304", async () => {
    const res = await app.request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe(String(TOTAL));
    const etag = res.headers.get("etag");
    expect(etag).toBe('"v1"');
    const res304 = await app.request(url, { headers: { "If-None-Match": etag! } });
    expect(res304.status).toBe(304);
  });
});
