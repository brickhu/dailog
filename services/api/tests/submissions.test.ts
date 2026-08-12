import { describe, expect, it } from "vitest";
import { submissionsRoutes } from "../src/routes/submissions";
import type { Repos } from "../src/repo";

// 投稿端点单测（ARC：API 契约 Vitest + Hono app 直测）：fake repo 注入行为，
// 覆盖校验/快照缺失/重复提交/成功/列表分支。鉴权由测试中间件注入 userId（与 profile.test 的 auth mock 等价）。

function makeRepo(overrides: { snapshots?: Partial<Repos["snapshots"]>; polishes?: Partial<Repos["polishes"]> } = {}): Repos {
  return {
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
      ...overrides.snapshots,
    },
    polishes: {
      findByUserSnapshot: async () => null,
      create: async () => ({ id: "polish-1" }),
      createSubmission: async () => ({ id: "sub-1" }),
      countPendingByUser: async () => 0,
      listSubmissionsByUser: async () => [],
      listQueue: async () => [],
      setStatus: async () => {},
      getOwned: async () => null,
      getPolishDetail: async () => null,
      listByUser: async () => [],
      ...overrides.polishes,
    },
  } as unknown as Repos;
}

function makeApp(repo: Repos) {
  const app = submissionsRoutes(repo);
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  return app;
}

describe("POST /v1/submissions", () => {
  it("缺少 snapshotId → 400 invalid_snapshot", async () => {
    const res = await makeApp(makeRepo()).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_snapshot" });
  });

  it("快照不存在 → 404", async () => {
    const repo = makeRepo({ snapshots: { getById: async () => null } });
    const res = await makeApp(repo).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap-missing" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("已提交过同一对话 → existing 返回已有容器", async () => {
    const repo = makeRepo({
      snapshots: { getById: async () => ({ parsedDialogue: null, sourceTitle: null, platform: "claude", prefixSourceId: null }) },
      polishes: { findByUserSnapshot: async () => ({ id: "sub-old", title: null, status: "submitted" }) },
    });
    const res = await makeApp(repo).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ existing: true, submissionId: "sub-old", status: "submitted" });
  });

  it("提交成功 → 201 submitted", async () => {
    const repo = makeRepo({
      snapshots: { getById: async () => ({ parsedDialogue: null, sourceTitle: "一次关于 AI 的对话", platform: "claude", prefixSourceId: null }) },
      polishes: { createSubmission: async () => ({ id: "sub-new" }) },
    });
    const res = await makeApp(repo).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap-1", title: "我的投稿标题" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ submissionId: "sub-new", status: "submitted" });
  });

  it("并发撞唯一约束 → 409 already_submitted", async () => {
    const repo = makeRepo({
      snapshots: { getById: async () => ({ parsedDialogue: null, sourceTitle: null, platform: "claude", prefixSourceId: null }) },
      polishes: { createSubmission: async () => ({ id: "" }) },
    });
    const res = await makeApp(repo).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap-1" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_submitted" });
  });
});

describe("GET /v1/me/submissions", () => {
  it("返回我的投稿列表", async () => {
    const repo = makeRepo({
      polishes: { listSubmissionsByUser: async () => [
        { id: "sub-1", title: "投稿一", status: "submitted", snapshotTitle: "对话A", platform: "claude", episodeStatus: null, rejectedReason: null, createdAt: new Date() },
        { id: "sub-2", title: "投稿二", status: "rejected", snapshotTitle: "对话B", platform: "chatgpt", episodeStatus: null, rejectedReason: null, createdAt: new Date() },
      ] },
    });
    const res = await makeApp(repo).request("/v1/me/submissions");
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "sub-1", status: "submitted" });
  });
});

describe("待审批投稿上限（pending_limit）", () => {
  it("待审批 >= 5 → 429 pending_limit，不创建投稿", async () => {
    let created = 0;
    const repo2 = makeRepo({
      polishes: {
        countPendingByUser: async () => 5,
        createSubmission: async () => { created++; return { id: "sub-x" }; },
      },
    });
    const res = await makeApp(repo2).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap-1" }),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "pending_limit", detail: { count: 5, limit: 5 } });
    expect(created).toBe(0);
  });

  it("待审批 4 条 → 正常创建", async () => {
    const res = await makeApp(makeRepo({
      snapshots: { getById: async () => ({ parsedDialogue: [], sourceTitle: "对话", platform: "claude" }) },
      polishes: { countPendingByUser: async () => 4 },
    })).request("/v1/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: "snap-1" }),
    });
    expect(res.status).toBe(201);
  });
});
