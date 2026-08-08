import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { importsRoutes } from "../src/routes/imports";

function makeApp(overrides: Partial<Record<string, unknown>> = {}) {
  const app = new Hono();
  app.route("/api", importsRoutes({
    getChannelActivatedAt: async () => new Date(),
    findImportBySource: async () => null,
    insertImport: async (row: unknown) => ({ id: "imp-1", ...(row as object) }),
    insertEpisode: async (row: unknown) => ({ id: "ep-1", ...(row as object) }),
    createImport: async () => ({ importId: "imp-1", episodeId: "ep-1" }),
    ...overrides,
  }, {
    // R2 存储 fake：断言对话写入 imports/{id}.dialogue.json
    put: async () => {},
    get: async () => new Uint8Array(),
    delete: async () => {},
  }));
  return app;
}

const dialogue = {
  platform: "claude",
  conversationId: "c-123",
  title: "测试对话",
  url: "https://claude.ai/chat/c-123",
  messages: [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好！" },
  ],
};

describe("POST /api/imports", () => {
  it("inserts import + draft episode", async () => {
    const res = await makeApp().request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dialogue),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.episodeId).toBe("ep-1");
  });

  it("returns 403 channel_not_activated when channel not created", async () => {
    const app = makeApp({ getChannelActivatedAt: async () => null });
    const res = await app.request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dialogue),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("channel_not_activated");
  });

  it("returns merged result when already imported (原对话缺失 → 保守 appended 0)", async () => {
    const app = makeApp({
      findImportBySource: async () => ({ id: "imp-0", episodeId: "ep-0" }),
    });
    const res = await app.request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dialogue),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      importId: "imp-0",
      episodeId: "ep-0",
      merged: true,
      appended: 0, // fake storage 无原对话 → 保守不追加
    });
  });

  it("returns 409 when insert reports duplicate (race)", async () => {
    // 并发竞态：预检查通过后 insert 撞唯一索引 → repo 返回 duplicate → 路由 409
    const app = makeApp({
      createImport: async () => ({ duplicate: true }),
    });
    const res = await app.request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dialogue),
    });
    expect(res.status).toBe(409);
  });

  it("rejects invalid dialogue", async () => {
    const res = await makeApp().request("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...dialogue, messages: [] }),
    });
    expect(res.status).toBe(400);
  });
});
