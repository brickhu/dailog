// 播放列表端点测试：公开（列表索引/详情）+ 我的收藏（增删查/公开校验/幂等）+ 编辑端（平台策展 CRUD/角色守卫）。
// fake repo 注入（helpers/fake-playlists），覆盖：收藏列表字段 / contains 透传 / 节目公开校验 / 去重幂等 / 角色 403。
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { playlistPublicRoutes, myFavoritesRoutes, playlistEditorRoutes } from "../src/routes/playlists";
import type { AuthEnv } from "../src/middleware/auth";
import type { PlaylistRow, Repos } from "../src/repo";
import { fakePlaylistsRepo } from "./helpers/fake-playlists";

const EPISODE_ID = "22222222-2222-4222-8222-222222222222";
const PLAYLIST_ID = "11111111-1111-4111-8111-111111111111";

const OWNED_PL: PlaylistRow = {
  id: PLAYLIST_ID,
  slug: "my-list",
  kind: "user",
  ownerId: "user-1",
  title: "我的列表",
  description: null,
  coverUrl: null,
  language: "zh",
  isPublic: true,
  isPicked: false,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function fakeRepo(overrides: Partial<Repos["playlists"]> = {}, episodesOverrides: Partial<Repos["episodes"]> = {}): Repos {
  return {
    notifications: {
      create: async () => {}, listByUser: async () => [], unreadCount: async () => 0, markAllRead: async () => {},
      getEmailByUserId: async () => null, existsAfter: async () => false, existsByLink: async () => false,
    },
    guests: {
      getByPlatform: async () => null, getById: async () => null, list: async () => [],
      voiceSampleByLanguage: async () => null, voiceSampleAny: async () => null, upsertVoiceSample: async () => {},
      update: async () => {}, listVoiceSamples: async () => [],
    },
    submissions: {
      create: async () => ({ id: "sub-1" }), findByUrl: async () => null, findById: async () => null,
      countPendingByUser: async () => 0, hasReadyVoiceSample: async () => true, listByUser: async () => [],
      getPublicById: async () => null, getByUser: async () => null, listQueue: async () => [], getDetail: async () => null,
      reject: async () => {}, markPublished: async () => {},
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
      listByUser: async () => [],
      getRemovalTarget: async () => null,
      createRemovalRequest: async () => ({ id: "rr-1" }),
      listRemovalRequests: async () => [],
      resolveRemovalRequest: async () => null,
                  listRecommended: async () => [],
      listTopHosts: async () => [],
      getSiteStats: async () => ({ hostCount: 0, guestCount: 0, episodeCount: 0, topHost: null, topHostAvatar: null, topTags: [] }),
      recordStat: async () => {},
      getStats: async () => ({ plays: 0, completions: 0, likes: 0 }),
      getPersonaSnapshot: async () => ({ displayName: "测试员", gender: null, profession: null, age: null, bio: null, nationality: null }),
      ...episodesOverrides,
    },
    playlists: { ...fakePlaylistsRepo(), ...overrides },
  };
}

/** 挂载带登录态（userId=user-1）的 /v1/me/favorites */
function favoritesApp(repo: Repos) {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use("*", async (c, next) => { c.set("userId", "user-1"); await next(); });
  app.route("/", myFavoritesRoutes(repo));
  return app;
}

/** 挂载带角色的 /v1/editor/playlists（含 fake storage——封面上传端点用） */
function editorApp(repo: Repos, role: "user" | "editor" | "admin" = "editor", storage: { put: (k: string, d: Uint8Array) => Promise<void>; get: () => Promise<{ data: Uint8Array; total: number }>; delete: () => Promise<void> } = {
  put: async () => {}, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {},
}) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => { c.set("userId", "editor-1"); c.set("role", role); await next(); });
  app.route("/", playlistEditorRoutes({ repo, storage }));
  return app;
}

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST" as const,
  headers: { "content-type": "application/json", ...extra },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// 公开
// ---------------------------------------------------------------------------

describe("公开播放列表端点", () => {
  it("GET /v1/public/playlists → 平台公开列表（精选优先）", async () => {
    const row: PlaylistRow & { episodeCount: number; firstCover: string | null; firstEpisodeId: string | null } = {
      ...OWNED_PL, id: "pl-1", slug: "abc", title: "精选合集", episodeCount: 3, firstCover: null, firstEpisodeId: null,
    };
    const listPublic = vi.fn(async () => [row]);
    const app = new Hono();
    app.route("/", playlistPublicRoutes(fakeRepo({ listPublic })));
    const res = await app.request("/v1/public/playlists?limit=10");
    expect(res.status).toBe(200);
    // JSON 序列化下 Date → ISO 字符串，按字段对比（不回环 Date 对象）
    expect(await res.json()).toMatchObject([{ id: "pl-1", slug: "abc", title: "精选合集", episodeCount: 3, firstCover: null }]);
    expect(listPublic).toHaveBeenCalledWith({ lang: undefined, limit: 10 });
  });

  it("GET /v1/public/playlists?lang=zh → 透传语言偏好（同语言优先）", async () => {
    const listPublic = vi.fn(async () => []);
    const app = new Hono();
    app.route("/", playlistPublicRoutes(fakeRepo({ listPublic })));
    const res = await app.request("/v1/public/playlists?lang=zh");
    expect(res.status).toBe(200);
    expect(listPublic).toHaveBeenCalledWith({ lang: "zh", limit: 20 });
  });

  it("GET /v1/public/playlists?lang=非法值 → 忽略参数", async () => {
    const listPublic = vi.fn(async () => []);
    const app = new Hono();
    app.route("/", playlistPublicRoutes(fakeRepo({ listPublic })));
    const res = await app.request("/v1/public/playlists?lang=123");
    expect(res.status).toBe(200);
    expect(listPublic).toHaveBeenCalledWith({ lang: undefined, limit: 20 });
  });

  it("GET /v1/public/playlists/:slug → 详情含公开节目（position 排序）", async () => {
    const detail = { ...OWNED_PL, episodes: [{ position: 0, episodeId: EPISODE_ID, slug: "ep-1", title: "第 1 期", coverUrl: null, durationSeconds: 300, publishedAt: new Date(), language: "zh", audioUrl: "episodes/u/1.mp3", username: "fei", displayName: "Fei", callName: "小北" }] };
    const app = new Hono();
    app.route("/", playlistPublicRoutes(fakeRepo({ getPublicBySlug: async () => detail })));
    const res = await app.request("/v1/public/playlists/my-list");
    expect(res.status).toBe(200);
    expect((await res.json()) as { slug: string; episodes: unknown[] }).toMatchObject({ slug: "my-list", episodes: [{ title: "第 1 期" }] });
  });

  it("GET /v1/public/playlists/:slug 不存在/未公开 → 404", async () => {
    const app = new Hono();
    app.route("/", playlistPublicRoutes(fakeRepo({ getPublicBySlug: async () => null })));
    const res = await app.request("/v1/public/playlists/secret");
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_found" });
  });
});

// ---------------------------------------------------------------------------
// 我的收藏（/v1/me/favorites）——收藏 = 每用户唯一默认列表的增删查
// ---------------------------------------------------------------------------

describe("我的收藏端点", () => {
  const FAV_ROW = {
    position: 2, episodeId: EPISODE_ID, slug: "ep-1", title: "第 1 期", coverUrl: null,
    durationSeconds: 300, publishedAt: new Date(), language: "zh", audioUrl: "episodes/u/1.mp3",
    username: "fei", displayName: "Fei", callName: "小北", guestName: "ChatGPT", tags: ["科技", "访谈"],
  };

  it("GET /v1/me/favorites → 我的收藏（含分组字段）", async () => {
    const listFavorites = vi.fn(async () => [FAV_ROW]);
    const app = favoritesApp(fakeRepo({ listFavorites }));
    const res = await app.request("/v1/me/favorites");
    expect(res.status).toBe(200);
    expect(listFavorites).toHaveBeenCalledWith("user-1");
    expect((await res.json()) as { episodes: unknown[] }).toMatchObject({
      episodes: [{ title: "第 1 期", guestName: "ChatGPT", tags: ["科技", "访谈"], position: 2 }],
    });
  });

  it("GET /v1/me/favorites?contains=<episodeId> → 附带是否已收藏", async () => {
    const listFavorites = vi.fn(async () => []);
    const isFavorite = vi.fn(async () => true);
    const app = favoritesApp(fakeRepo({ listFavorites, isFavorite }));
    const res = await app.request(`/v1/me/favorites?contains=${EPISODE_ID}`);
    expect(res.status).toBe(200);
    expect(isFavorite).toHaveBeenCalledWith("user-1", EPISODE_ID);
    expect((await res.json()) as { episodes: unknown[]; contains: boolean }).toEqual({ episodes: [], contains: true });
  });

  it("GET /v1/me/favorites?contains=非法值 → 忽略（不返回 contains）", async () => {
    const isFavorite = vi.fn(async () => true);
    const app = favoritesApp(fakeRepo({ isFavorite }));
    const res = await app.request("/v1/me/favorites?contains=not-a-uuid");
    expect(res.status).toBe(200);
    expect(isFavorite).not.toHaveBeenCalled();
    expect((await res.json()) as { contains?: boolean }).toEqual({ episodes: [] });
  });

  it("POST /v1/me/favorites/:episodeId 公开节目 → 收藏（重复幂等 added=false）", async () => {
    const addFavorite = vi.fn(async () => ({ added: false }));
    const app = favoritesApp(fakeRepo(
      { addFavorite },
      { getPublicAudioKey: async () => ({ audioKey: "episodes/u/1.mp3", version: "v" }) },
    ));
    const res = await app.request(`/v1/me/favorites/${EPISODE_ID}`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, added: false });
    expect(addFavorite).toHaveBeenCalledWith("user-1", EPISODE_ID);
  });

  it("POST /v1/me/favorites/:episodeId 节目未公开/不存在 → 400", async () => {
    const addFavorite = vi.fn(async () => ({ added: true }));
    const app = favoritesApp(fakeRepo({ addFavorite }));
    const res = await app.request(`/v1/me/favorites/${EPISODE_ID}`, { method: "POST" });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "episode_not_public" });
    expect(addFavorite).not.toHaveBeenCalled();
  });

  it("POST /v1/me/favorites/:episodeId 非法 uuid → 400", async () => {
    const app = favoritesApp(fakeRepo());
    const res = await app.request("/v1/me/favorites/not-a-uuid", { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("DELETE /v1/me/favorites/:episodeId → 取消收藏", async () => {
    const removeFavorite = vi.fn(async () => {});
    const app = favoritesApp(fakeRepo({ removeFavorite }));
    const res = await app.request(`/v1/me/favorites/${EPISODE_ID}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(removeFavorite).toHaveBeenCalledWith("user-1", EPISODE_ID);
  });
});

// ---------------------------------------------------------------------------
// 编辑端（平台策展）
// ---------------------------------------------------------------------------

describe("编辑端播放列表端点", () => {
  it("GET /v1/editor/playlists 普通用户 → 403", async () => {
    const app = editorApp(fakeRepo(), "user");
    const res = await app.request("/v1/editor/playlists");
    expect(res.status).toBe(403);
  });

  it("GET /v1/editor/playlists 编辑 → 全部平台列表", async () => {
    const listEditor = vi.fn(async () => [{ ...OWNED_PL, episodeCount: 1, firstCover: null, firstEpisodeId: null }]);
    const app = editorApp(fakeRepo({ listEditor }));
    const res = await app.request("/v1/editor/playlists");
    expect(res.status).toBe(200);
    expect(listEditor).toHaveBeenCalledOnce();
  });

  it("POST /v1/editor/playlists → 创建平台列表（kind=platform + owner）", async () => {
    const create = vi.fn(async () => ({ id: "pl-ed", slug: "editor-list" }));
    const app = editorApp(fakeRepo({ create }));
    const res = await app.request("/v1/editor/playlists", json({ title: "本周精选", description: "编辑推荐", isPicked: true }));
    expect(res.status).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ kind: "platform", ownerId: "editor-1", title: "本周精选", isPicked: true }));
  });

  it("POST /v1/editor/playlists 空标题 → 400", async () => {
    const app = editorApp(fakeRepo());
    const res = await app.request("/v1/editor/playlists", json({ title: "" }));
    expect(res.status).toBe(400);
  });

  it("PATCH /v1/editor/playlists/:id → 更新平台列表（含 isPicked/isPublic）", async () => {
    const update = vi.fn(async () => {});
    const app = editorApp(fakeRepo({ getById: async () => ({ ...OWNED_PL, kind: "platform" as const }), update }));
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}`, { ...json({ isPicked: true, isPublic: false }), method: "PATCH" });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(PLAYLIST_ID, { isPicked: true, isPublic: false });
  });

  it("DELETE /v1/editor/playlists/:id → 删除平台列表", async () => {
    const remove = vi.fn(async () => {});
    const app = editorApp(fakeRepo({ getById: async () => ({ ...OWNED_PL, kind: "platform" as const }), remove }));
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(PLAYLIST_ID);
  });

  it("POST /v1/editor/playlists/:id/episodes 公开节目 → 添加", async () => {
    const addEpisode = vi.fn(async () => ({ added: true }));
    const app = editorApp(fakeRepo(
      { getById: async () => ({ ...OWNED_PL, kind: "platform" as const }), addEpisode },
      { getPublicAudioKey: async () => ({ audioKey: "episodes/u/1.mp3", version: "v" }) },
    ));
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}/episodes`, json({ episodeId: EPISODE_ID }));
    expect(res.status).toBe(200);
    expect(addEpisode).toHaveBeenCalledWith(PLAYLIST_ID, EPISODE_ID);
  });

  it("PUT /v1/editor/playlists/:id/episodes/reorder → 重排", async () => {
    const reorder = vi.fn(async () => {});
    const app = editorApp(fakeRepo({ getById: async () => ({ ...OWNED_PL, kind: "platform" as const }), reorder }));
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}/episodes/reorder`, { ...json({ episodeIds: [EPISODE_ID] }), method: "PUT" });
    expect(res.status).toBe(200);
    expect(reorder).toHaveBeenCalledWith(PLAYLIST_ID, [EPISODE_ID]);
  });

  it("POST /v1/editor/playlists/:id/cover → 上传封面（sharp 归一 JPEG → R2 + 更新 coverUrl）", async () => {
    const storagePut = vi.fn(async () => {});
    const update = vi.fn(async () => {});
    const app = editorApp(
      fakeRepo({ getById: async () => ({ ...OWNED_PL, kind: "platform" as const }), update }),
      "editor",
      { put: storagePut, get: async () => ({ data: new Uint8Array(), total: 0 }), delete: async () => {} },
    );
    // 真实 1×1 JPEG（sharp 可解析）
    const jpegBytes = new Uint8Array(Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==",
      "base64",
    ));
    const form = new FormData();
    form.append("cover", new Blob([jpegBytes], { type: "image/jpeg" }), "cover.jpg");
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}/cover`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { coverUrl: string };
    expect(body.coverUrl).toBe(`covers/playlists/${PLAYLIST_ID}.jpg`);
    expect(storagePut).toHaveBeenCalledWith(`covers/playlists/${PLAYLIST_ID}.jpg`, expect.any(Uint8Array));
    expect(update).toHaveBeenCalledWith(PLAYLIST_ID, { coverUrl: `covers/playlists/${PLAYLIST_ID}.jpg` });
  });

  it("POST /v1/editor/playlists/:id/cover 缺文件 → 400", async () => {
    const app = editorApp(fakeRepo({ getById: async () => ({ ...OWNED_PL, kind: "platform" as const }) }));
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}/cover`, { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "cover_required" });
  });

  it("POST /v1/editor/playlists/:id/cover 非图片 → 400", async () => {
    const app = editorApp(fakeRepo({ getById: async () => ({ ...OWNED_PL, kind: "platform" as const }) }));
    const form = new FormData();
    form.append("cover", new Blob([new Uint8Array([1, 2, 3])], { type: "text/plain" }), "x.txt");
    const res = await app.request(`/v1/editor/playlists/${PLAYLIST_ID}/cover`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "invalid_cover" });
  });
});