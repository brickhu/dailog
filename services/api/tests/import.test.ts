import { describe, expect, it } from "vitest";
import { importRoutes, type ImportDeps } from "../src/routes/import";

// /v1/import 平台预检单测（ARC：API 契约 Vitest + Hono app 直测）：
// 覆盖 URL 格式 / 平台规则匹配 / 非支持平台 400 / importer 不可达 503 / 快照缓存命中跳过采集

const RULES = [
  { id: "claude", label: "Claude", sharePattern: "^https?:\\/\\/(www\\.)?claude\\.ai\\/share\\/[0-9a-f-]{36}" },
  { id: "chatgpt", label: "ChatGPT", sharePattern: "^https?:\\/\\/(www\\.)?chatgpt\\.com\\/share\\/[A-Za-z0-9-]+" },
];

function makeDeps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  return {
    getSnapshotByUrl: async () => null,
    createSnapshot: async (row) => ({ id: "snap-1", ...row, parsedDialogue: null }),
    updateSnapshotContent: async () => {},
    markSnapshotUnreachable: async () => {},
    markSnapshotParseFailed: async () => {},
    findPolishByUserSnapshot: async () => null,
    getPlatformRules: async () => RULES,
    ...overrides,
  };
}

function makeApp(deps: ImportDeps) {
  const app = importRoutes(deps);
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  return app;
}

function post(app: ReturnType<typeof makeApp>, url: string) {
  return app.request("/v1/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

describe("POST /v1/import 平台预检", () => {
  it("非 http(s) 链接 → 400 invalid_url", async () => {
    const res = await post(makeApp(makeDeps()), "not-a-url");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_url" });
  });

  it("不匹配任何平台分享页 → 400 unsupported_platform（不触发采集）", async () => {
    let collected = false;
    const deps = makeDeps({
      createSnapshot: async () => {
        collected = true;
        return { id: "snap-1" };
      },
    });
    const res = await post(makeApp(deps), "https://example.com/share/abc");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsupported_platform" });
    expect(collected).toBe(false);
  });

  it("平台域名对但 ID 格式不对（如对话页而非分享页）→ 400 unsupported_platform", async () => {
    const res = await post(makeApp(makeDeps()), "https://claude.ai/chat/abc123");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unsupported_platform" });
  });

  it("匹配平台分享页且快照已缓存 → 直接返回对话（不调 importer）", async () => {
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-1",
        platform: "claude",
        sourceTitle: "已缓存对话",
        sourceConversationId: "conv-1",
        parsedDialogue: [
          { role: "user", content: "你觉得 AI 会如何改变我们的工作和生活方式？这是最近我一直在思考的问题，因为身边越来越多的朋友开始用 AI 处理日常事务，从写邮件到做方案，变化非常明显，我想知道这背后真正的逻辑是什么。" },
          { role: "assistant", content: "AI 会重新定义哪些工作值得人做，让重复劳动自动化，把人的时间释放给判断和创造。真正稀缺的从来不是执行，而是判断力、审美和对问题的定义能力。这是我在和不同行业的朋友交流后得到的共同结论。" },
          { role: "user", content: "那对普通人的职业选择有什么具体建议？比如我现在做内容创作，应该怎么调整方向？是应该更依赖工具，还是应该刻意保持某些不依赖工具的能力？这个问题困扰我很久了。" },
          { role: "assistant", content: "内容创作的门槛会降低，但天花板会更高——工具让平庸表达变便宜，思想和情感仍然只能来自人。建议你把 AI 当成杠杆，而不是替代品：它放大你的判断，但不会替你产生判断。关键在于你要始终清楚自己想要什么。" },
          { role: "user", content: "听起来很抽象，你能举一个具体例子吗？比如同样写一篇文章，有 AI 和没有 AI 的区别在哪里？我应该如何把工具用在刀刃上，而不是被工具牵着走？" },
          { role: "assistant", content: "区别在于迭代成本：没有 AI 时改一稿要半天，有 AI 时你可以在十分钟内试验十种表达，然后把精力留给最难的判断——什么值得写、写给谁看、什么观点真正属于你。这就是杠杆的正确用法。" },
        ],
        status: "ok",
        retryAfter: null,
        lastError: null,
      }),
    });
    const res = await post(makeApp(deps), "https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snapshotId?: string };
    expect(body.snapshotId).toBe("snap-1");
  });

  it("importer 不可达（规则为 null）→ 503 share_collect_not_configured", async () => {
    const res = await post(makeApp(makeDeps({ getPlatformRules: async () => null })), "https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "share_collect_not_configured" });
  });
});
