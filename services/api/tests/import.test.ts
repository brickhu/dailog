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
      parseShareHtml: async () => null,
      listTraceableSnapshots: async () => [],
      setSnapshotSourceTrace: async () => {},
      findPublishedEpisodeBySnapshot: async () => null,
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
        fingerprint: null,
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

  it("unreachable 快照过 TTL（无内容）→ 重新采集并更新内容，不返回空对话", async () => {
    const updates: string[] = [];
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-stale", platform: "plain", sourceTitle: null, sourceConversationId: null,
        parsedDialogue: null, fingerprint: null, status: "unreachable",
        retryAfter: new Date(Date.now() - 1000), lastError: "上次超时",
      }),
      updateSnapshotContent: async (_id, row) => { updates.push(String(row.platform)); },
      getPlatformRules: async () => RULES,
    });
    const res = await post(makeApp(deps), "https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef");
    // 无 IMPORTER_URL 环境 → 采集失败（422 not_configured）；关键：走"重新采集"路径而非把空快照当内容返回
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "share_collect_not_configured" });
    expect(updates).toHaveLength(0); // 采集失败不更新
  });
});

describe("POST /v1/import 节目预览态（alreadyPublished）", () => {
  const URL = "https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef";
  const SOURCE = [
    { role: "user", content: "第一问：AI 会如何改变我们的工作和生活方式？这是最近我一直在思考的问题，因为身边越来越多的朋友开始用 AI 处理日常事务，从写邮件到做方案，变化非常明显，我想知道这背后真正的逻辑是什么，也想听听你的看法。" },
    { role: "assistant", content: "AI 会重新定义哪些工作值得人做，让重复劳动自动化，把人的时间释放给判断和创造。真正稀缺的从来不是执行，而是判断力、审美和对问题的定义能力，这是我在和不同行业的朋友交流后得到的共同结论。" },
    { role: "user", content: "第二问：对普通人的职业选择有什么具体建议？比如我现在做内容创作，应该怎么调整方向？是应该更依赖工具，还是应该刻意保持某些不依赖工具的能力？这个问题困扰我很久了，希望你能给我一些可执行的建议。" },
    { role: "assistant", content: "内容创作的门槛会降低，但天花板会更高——工具让平庸表达变便宜，思想和情感仍然只能来自人。建议你把 AI 当成杠杆，而不是替代品：它放大你的判断，但不会替你产生判断，关键在于你要始终清楚自己想要什么。" },
    { role: "user", content: "第三问：听起来很抽象，你能举一个具体例子吗？比如同样写一篇文章，有 AI 和没有 AI 的区别在哪里？我应该如何把工具用在刀刃上，而不是被工具牵着走？" },
    { role: "assistant", content: "区别在于迭代成本：没有 AI 时改一稿要半天，有 AI 时你可以在十分钟内试验十种表达，然后把精力留给最难的判断——什么值得写、写给谁看、什么观点真正属于你，这就是杠杆的正确用法。" },
  ];

  it("该快照已有任意用户的节目 → alreadyPublished + 节目信息（不进入确认导入）", async () => {
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-1", platform: "claude", sourceTitle: "已收录对话", sourceConversationId: "conv-1",
        parsedDialogue: SOURCE, fingerprint: "abc", status: "ok", retryAfter: null, lastError: null,
      }),
      findPublishedEpisodeBySnapshot: async () => ({
        id: "ep-9", title: "AI 会改变什么", durationSeconds: 240, hostName: "小石", guestName: "Claude",
      }),
    });
    const res = await post(makeApp(deps), URL);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      alreadyPublished: true,
      episode: { id: "ep-9", title: "AI 会改变什么", durationSeconds: 240, hostName: "小石", guestName: "Claude" },
    });
    // 预览态不返回 dialogue/继续导入所需字段
    expect(body.snapshotId).toBeUndefined();
  });

  it("无已生成节目 → 正常导入流程（无 alreadyPublished）", async () => {
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-1", platform: "claude", sourceTitle: "普通对话", sourceConversationId: "conv-1",
        parsedDialogue: SOURCE, fingerprint: "abc", status: "ok", retryAfter: null, lastError: null,
      }),
      findPublishedEpisodeBySnapshot: async () => null,
    });
    const res = await post(makeApp(deps), URL);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyPublished).toBeUndefined();
    expect(body.snapshotId).toBe("snap-1");
  });
});

describe("POST /v1/import 内容溯源（前缀检测）", () => {
  const URL = "https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef";
  const SOURCE = [
    { role: "user", content: "第一问：AI 会如何改变我们的工作和生活方式？这是最近我一直在思考的问题，因为身边越来越多的朋友开始用 AI 处理日常事务，从写邮件到做方案，变化非常明显，我想知道这背后真正的逻辑是什么，也想听听你的看法。" },
    { role: "assistant", content: "AI 会重新定义哪些工作值得人做，让重复劳动自动化，把人的时间释放给判断和创造。真正稀缺的从来不是执行，而是判断力、审美和对问题的定义能力，这是我在和不同行业的朋友交流后得到的共同结论。" },
    { role: "user", content: "第二问：对普通人的职业选择有什么具体建议？比如我现在做内容创作，应该怎么调整方向？是应该更依赖工具，还是应该刻意保持某些不依赖工具的能力？这个问题困扰我很久了，希望你能给我一些可执行的建议。" },
    { role: "assistant", content: "内容创作的门槛会降低，但天花板会更高——工具让平庸表达变便宜，思想和情感仍然只能来自人。建议你把 AI 当成杠杆，而不是替代品：它放大你的判断，但不会替你产生判断，关键在于你要始终清楚自己想要什么。" },
    { role: "user", content: "第三问：听起来很抽象，你能举一个具体例子吗？比如同样写一篇文章，有 AI 和没有 AI 的区别在哪里？我应该如何把工具用在刀刃上，而不是被工具牵着走？" },
    { role: "assistant", content: "区别在于迭代成本：没有 AI 时改一稿要半天，有 AI 时你可以在十分钟内试验十种表达，然后把精力留给最难的判断——什么值得写、写给谁看、什么观点真正属于你，这就是杠杆的正确用法。" },
  ];
  const DERIVED = [
    ...SOURCE,
    { role: "user", content: "第四问：那我自己应该怎么开始？我现在是内容创作者，也想把和 AI 的对话变成节目，应该从哪里入手？" },
    { role: "assistant", content: "从一个小问题开始，每周和 AI 深度聊一次，把有价值的对话存下来，慢慢就会形成自己的话题库和表达风格。" },
  ];

  it("新快照内容以库内快照为前缀 → 写 prefix_source_id + 响应 suspectedSource", async () => {
    const traces: Array<{ fingerprint: string | null; prefixSourceId: string | null }> = [];
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-2", platform: "claude", sourceTitle: "衍生对话", sourceConversationId: "conv-2",
        parsedDialogue: DERIVED, fingerprint: null, status: "ok", retryAfter: null, lastError: null,
      }),
      listTraceableSnapshots: async () => [{ id: "snap-1", sourceTitle: "原始对话", parsedDialogue: SOURCE }],
      setSnapshotSourceTrace: async (_id, row) => { traces.push(row); },
    });
    const res = await post(makeApp(deps), URL);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspectedSource).toMatchObject({ snapshotId: "snap-1", sourceTitle: "原始对话" });
    expect(traces[0]?.prefixSourceId).toBe("snap-1");
    expect(traces[0]?.fingerprint).toBeTruthy();
  });

  it("无前缀匹配 → 不返回 suspectedSource，prefixSourceId 为 null", async () => {
    const traces: Array<{ prefixSourceId: string | null }> = [];
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-2", platform: "claude", sourceTitle: "独立对话", sourceConversationId: "conv-2",
        parsedDialogue: DERIVED, fingerprint: null, status: "ok", retryAfter: null, lastError: null,
      }),
      listTraceableSnapshots: async () => [{ id: "snap-1", sourceTitle: "无关对话", parsedDialogue: [{ role: "user", content: "完全无关的内容，没有任何消息相同，这里只是占位符。" }, { role: "assistant", content: "另一条无关回复，仅用于凑够候选数量。" }] }],
      setSnapshotSourceTrace: async (_id, row) => { traces.push(row); },
    });
    const res = await post(makeApp(deps), URL);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.suspectedSource).toBeUndefined();
    expect(traces[0]?.prefixSourceId).toBeNull();
  });

  it("已有指纹的快照（历史已计算）→ 跳过重复检测", async () => {
    let tracedCalls = 0;
    const deps = makeDeps({
      getSnapshotByUrl: async () => ({
        id: "snap-1", platform: "claude", sourceTitle: "已算过", sourceConversationId: "conv-1",
        parsedDialogue: DERIVED, fingerprint: "existing-fp", status: "ok", retryAfter: null, lastError: null,
      }),
      listTraceableSnapshots: async () => [{ id: "snap-0", sourceTitle: "源", parsedDialogue: SOURCE }],
      setSnapshotSourceTrace: async () => { tracedCalls++; },
    });
    const res = await post(makeApp(deps), URL);
    expect(res.status).toBe(200);
    expect(tracedCalls).toBe(0);
  });
});

describe("POST /v1/import-paste（手动粘贴兜底）", () => {
  const TEXT = `You:
帮我翻译这句话：Hello world，这是一段足够长的测试文本，用来验证粘贴导入的完整流程，同时确保内容超过一百字的最低门槛要求，让整个流程可以顺畅地跑通。

ChatGPT:
你好，世界。这是一句简单的英文问候语，祝你一天愉快。翻译时要保持原文的语气和风格，不要添加额外的解释。`;

  it("解析成功 → 建快照 + 返回 dialogue（platform=plain）", async () => {
    const createdRows: Array<{ url?: string; platform?: string }> = [];
    const deps = makeDeps({
      createSnapshot: async (row) => { createdRows.push(row); return { id: "snap-paste-1" }; },
      listTraceableSnapshots: async () => [],
      setSnapshotSourceTrace: async () => {},
    });
    const res = await appRequest(makeApp(deps), "/v1/import-paste", TEXT);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshotId).toBe("snap-paste-1");
    expect(body.dialogue.platform).toBe("plain");
    expect(body.dialogue.messages).toHaveLength(2);
    expect(body.dialogue.messages[0]).toMatchObject({ role: "user", content: expect.stringContaining("Hello world") });
    expect(createdRows[0]?.url).toMatch(/^paste:/);
  });

  it("文本过短 → 400 invalid_text", async () => {
    const res = await appRequest(makeApp(makeDeps()), "/v1/import-paste", "太短了");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_text" });
  });

  it("无法解析出对话结构 → 400 invalid_text（import-paste 直建需有效 messages）", async () => {
    const res = await appRequest(makeApp(makeDeps()), "/v1/import-paste", "这是一段很长的普通文本，没有任何对话结构，只是单纯的一堆文字而已，凑够长度。");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_text" });
  });

  it("/parse 端点：无法解析 → 422 parse_failed", async () => {
    const res = await makeApp(makeDeps()).request("/v1/import-paste/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "这是一段很长的普通文本，没有任何对话结构，只是单纯的一堆文字而已，凑够长度。" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "parse_failed" });
  });
});

function appRequest(app: ReturnType<typeof makeApp>, path: string, text: string) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

describe("POST /v1/import-paste/parse（解析不建库）+ 校对 messages 直建", () => {
  const TEXT = `You:
帮我翻译这句话：Hello world，这是一段足够长的测试文本，用来验证粘贴导入的完整流程，同时确保内容超过一百字的最低门槛要求，让整个流程可以顺畅地跑通。

ChatGPT:
你好，世界。这是一句简单的英文问候语，祝你一天愉快。翻译时要保持原文的语气和风格，不要添加额外的解释。`;

  it("parse 端点：解析返回 messages，不建快照", async () => {
    let created = 0;
    const deps = makeDeps({
      createSnapshot: async () => { created++; return { id: "snap-x" }; },
    });
    const app = makeApp(deps);
    const res = await app.request("/v1/import-paste/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: TEXT }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toMatchObject({ role: "user" });
    expect(created).toBe(0);
  });

  it("import-paste：接收校对后的 messages（无标记内容也能正确建快照）", async () => {
    const createdRows: Array<{ parsedDialogue?: unknown }> = [];
    const deps = makeDeps({
      createSnapshot: async (row) => { createdRows.push(row); return { id: "snap-paste-2" }; },
      listTraceableSnapshots: async () => [],
      setSnapshotSourceTrace: async () => {},
    });
    const res = await appRequest(makeApp(deps), "/v1/import-paste", "");
    // 用 messages 直建（模拟前端校对后提交）
    const res2 = await makeApp(deps).request("/v1/import-paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "第一段：没有标记的文本，用户手动校对为 user 角色，内容足够长以通过门槛校验。" },
          { role: "assistant", content: "第二段：用户手动校对为 assistant 角色，AI 的回答内容也要足够长才能通过检查。" },
          { role: "user", content: "第三段：继续提问，这段内容同样需要足够的长度来满足最低字数要求。" },
          { role: "assistant", content: "第四段：最后的回答，内容完整，这样整个对话就符合播客制作的基本要求了。" },
        ],
      }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.snapshotId).toBe("snap-paste-2");
    expect(body2.dialogue.messages).toHaveLength(4);
    expect(body2.dialogue.messages[1]).toMatchObject({ role: "assistant" });
    expect((createdRows[0]?.parsedDialogue as { role: string }[])?.[3]?.role).toBe("assistant");
    void res;
  });

  it("messages 非法（角色错误/内容空）→ 400", async () => {
    const res = await makeApp(makeDeps()).request("/v1/import-paste", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "system", content: "x" }] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_text" });
  });
});

describe("POST /v1/import-paste/html（源码粘贴）", () => {
  const HTML = `<html><head><title>测试 - Perplexity</title></head><body>
    <script id="__NEXT_DATA__" type="application/json">{"thread":{"queries":["第一问：内容足够长，用来验证源码粘贴导入的完整流程和消息解析逻辑，这里继续补充文字。","第二问：继续提问，确保消息数量符合要求，这里也补充足够长的文字。"],"answers":["第一答：AI 的回答内容同样需要足够长才能通过字数校验，这里补充一些内容。","第二答：最后的回答，内容完整，满足播客制作的基本要求。"],"title":"测试对话"}}</script>
  </body></html>`;

  it("解析成功 → 建快照 + 返回 dialogue（platform 来自解析器）", async () => {
    const createdRows: Array<{ parsedDialogue?: unknown }> = [];
    const deps = makeDeps({
      parseShareHtml: async () => ({
        platform: "perplexity",
        conversationId: "conv-1",
        title: "测试对话",
        url: "https://www.perplexity.ai/search/x",
        messages: [
          { role: "user", content: "第一问：内容足够长，用来验证源码粘贴导入的完整流程和消息解析逻辑，这里继续补充文字。" },
          { role: "assistant", content: "第一答：AI 的回答内容同样需要足够长才能通过字数校验，这里补充一些内容。" },
          { role: "user", content: "第二问：继续提问，确保消息数量符合要求，这里也补充足够长的文字。" },
          { role: "assistant", content: "第二答：最后的回答，内容完整，满足播客制作的基本要求。" },
        ],
      }),
      createSnapshot: async (row) => { createdRows.push(row); return { id: "snap-html-1" }; },
      listTraceableSnapshots: async () => [],
      setSnapshotSourceTrace: async () => {},
    });
    const res = await makeApp(deps).request("/v1/import-paste/html", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: HTML, url: "https://www.perplexity.ai/search/fan-yi-4O_bpNVoTgSdr4hOzrrZ1w" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshotId).toBe("snap-html-1");
    expect(body.dialogue.platform).toBe("perplexity");
    expect(body.dialogue.messages).toHaveLength(4);
  });

  it("解析失败 → 422 parse_failed", async () => {
    const deps = makeDeps({ parseShareHtml: async () => null });
    const res = await makeApp(deps).request("/v1/import-paste/html", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "<html>some html content here that is long enough</html>", url: "https://www.perplexity.ai/search/x" }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "parse_failed" });
  });

  it("html 过短/缺 url → 400", async () => {
    const res = await makeApp(makeDeps()).request("/v1/import-paste/html", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html: "short" }),
    });
    expect(res.status).toBe(400);
  });
});
