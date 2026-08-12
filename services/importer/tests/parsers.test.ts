import { describe, expect, it } from "vitest";
import { parseClaudeSnapshot } from "../src/platforms/claude";
import { parseDeepSeekApi } from "../src/platforms/deepseek";
import { parseChatgptShareRsc, parseChatgptShareHtml } from "../src/platforms/chatgpt";
import { parseDoubaoShare } from "../src/platforms/doubao";
import { parseGeminiBatch, parseGeminiPayload } from "../src/platforms/gemini";
import { parseKimiShare } from "../src/platforms/kimi";

const URL = "https://example.com/share/123";

describe("claude chat_snapshots 解析", () => {
  it("解析消息与标题（snapshot_name）", () => {
    const json = JSON.stringify({
      snapshot_name: "MRD 讨论",
      chat_messages: [
        { sender: "human", text: "帮我写 MRD", attachments: [] },
        { sender: "assistant", text: "好的，以下是 MRD 要点：\n\n**目标用户**", attachments: [] },
        { sender: "system", text: "系统消息应被过滤" },
        { sender: "human", text: "", attachments: [{ extracted_content: "附件正文" }] },
      ],
    });
    const d = parseClaudeSnapshot(json, "abc", URL);
    expect(d).not.toBeNull();
    expect(d!.title).toBe("MRD 讨论");
    expect(d!.messages).toHaveLength(3); // 过滤 system + 空文本并入附件
    expect(d!.messages[0]).toEqual({ role: "user", content: "帮我写 MRD" });
    expect(d!.messages[1].content).toContain("**目标用户**");
    expect(d!.messages[2]).toEqual({ role: "user", content: "附件正文" });
  });

  it("无消息返回 null", () => {
    expect(parseClaudeSnapshot(JSON.stringify({ chat_messages: [] }), "a", URL)).toBeNull();
  });
});

describe("deepseek share/content 解析", () => {
  it("role 大小写不敏感 + 过滤空", () => {
    const json = JSON.stringify({
      data: { biz_data: { title: "测试对话", messages: [
        { role: "USER", content: "你好" },
        { role: "assistant", content: "你好！有什么可以帮你" },
        { role: "system", content: "" },
      ] } },
    });
    const d = parseDeepSeekApi(json, "id", URL);
    expect(d!.title).toBe("测试对话");
    expect(d!.messages).toHaveLength(2);
    expect(d!.messages[0].role).toBe("user");
  });
});

describe("chatgpt RSC 解码", () => {
  it("解析全量 mapping 对话（children DFS）", () => {
    const mappingGraph = {
      root: { message: null, children: ["u1"] },
      u1: { message: { author: { role: "user" }, content: { parts: ["第一问"] } }, children: ["a1"] },
      a1: { message: { author: { role: "assistant" }, content: { parts: ["第一答", "续"] } }, children: ["u2"] },
      u2: { message: { author: { role: "user" }, content: { parts: ["第二问"] } }, children: [] },
    };
    // 值表引用规则：数字 v → 展开表[v]（记忆化）；对象 {_N: M} → 键=展开表[N]，值=展开 M。
    // 目标结构：root.loaderData["routes/..."].serverResponse.data = {mapping: 节点图, conversation_id, title}
    // 表[0] 是根对象（resolve(0) 的起点）；_N 的 N 指向键名字符串所在位置
    const table: unknown[] = [
      { _1: 10 },                                     // 0  根对象 = {loaderData: 展开10}
      "loaderData",                                   // 1  键名
      "routes/share.$shareId.($action)",              // 2
      "serverResponse",                               // 3
      "data",                                         // 4
      "mapping",                                      // 5
      "conversation_id",                              // 6
      "title",                                        // 7
      "conv-1",                                       // 8
      "Aimark 讨论",                                  // 9
      { _2: 11 },                                     // 10 路由对象 = {routes/...: 展开11}
      { _3: 12 },                                     // 11 serverResponse = {serverResponse: 展开12}
      { _4: 13 },                                     // 12 data 容器 = {data: 展开13}
      { _5: 15, _6: 8, _7: 9 },                       // 13 完整 data = {mapping: 展开15, conversation_id: "conv-1", title: "Aimark 讨论"}
      "占位",                                         // 14
      mappingGraph,                                   // 15 纯 mapping 节点图
    ];
    const html = `<script>streamController.enqueue("P1:${JSON.stringify(table).replace(/"/g, '\\"')}")</script>`;
    const d = parseChatgptShareRsc(html, "conv-1", URL);
    expect(d).not.toBeNull();
    expect(d!.title).toBe("Aimark 讨论");
    expect(d!.conversationId).toBe("conv-1");
    expect(d!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(d!.messages[1].content).toBe("第一答\n\n续");
  });

  it("静态 HTML 兜底（data-message-author-role）", () => {
    // 真实页面：消息 div 外层有 section 闭合（正则 lookahead 依赖）
    const html = `<section><div data-message-author-role="user"><p>问题</p></div><div data-message-author-role="assistant"><p>回答</p></div></section>`;
    const d = parseChatgptShareHtml(html, "id", URL);
    expect(d!.messages).toHaveLength(2);
    expect(d!.messages[0]).toEqual({ role: "user", content: "问题" });
    expect(d!.messages[1]).toEqual({ role: "assistant", content: "回答" });
  });
});

describe("doubao SSR 快照解析", () => {
  it("data-fn-args 多层转义 + user_type 角色", () => {
    const snap = {
      data: {
        share_info: { share_name: "文竹养护" },
        message_snapshot: {
          message_list: [
            { user_type: 1, content_block: [{ content: { text_block: { text: "文竹发黄怎么办" } } }] },
            { user_type: 2, content_block: [
              { content: { text_block: { text: "别慌！**先判断原因**" } } },
              { content: { text_block: { text: "---" } } },
            ] },
            { user_type: 1, content_block: [{ content: { text_block: { text: "" } } }] },
          ],
        },
      },
    };
    // 模拟 data-fn-args：HTML 实体 + JSON 双重转义
    const inner = JSON.stringify([null, [{ routerDataFnArgs: [JSON.stringify(snap)] }]]);
    const htmlEscaped = inner.replace(/"/g, "&quot;");
    const html = `<script data-fn-name="mergeLoaderData" data-fn-args="${htmlEscaped}"></script>`;
    const d = parseDoubaoShare(html, "share1", URL);
    expect(d).not.toBeNull();
    expect(d!.title).toBe("文竹养护");
    expect(d!.messages).toHaveLength(2); // 空文本过滤
    expect(d!.messages[0].role).toBe("user");
    expect(d!.messages[1].content).toContain("**先判断原因**");
  });
});

describe("gemini batchexecute 解析", () => {
  it("长度分块格式", () => {
    const payload = JSON.stringify([[null, [
      [["c1", "r1"], null, [["问题1"]], [[["rc_1", ["回答1"]]]], {}, {}],
      [["c1", "r2"], null, [["问题2"]], [[["rc_2", ["回答2"]]]], {}, {}],
    ]]]);
    const block = JSON.stringify([["wrb.fr", "ujx1Bf", payload, null, null, null, "generic"]]);
    const text = `)]}'\n\n${block.length}\n${block}\n58\n[["di",1837]]`;
    const parsed = parseGeminiBatch(text);
    expect(parsed).not.toBeNull();
    const d = parseGeminiPayload(parsed!, "conv1", URL);
    expect(d!.messages).toHaveLength(4);
    expect(d!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(d!.messages[0].content).toBe("问题1");
  });

  it("无长度行直接 JSON 格式", () => {
    const payload = JSON.stringify([[null, [
      [["c1", "r1"], null, [["问题"]], [[["rc_1", ["回答"]]]], {}, {}],
    ]]]);
    const block = JSON.stringify([["wrb.fr", "ujx1Bf", payload, null, null, null, "generic"]]);
    const text = `)]}'\n\n${block}`;
    const parsed = parseGeminiBatch(text);
    expect(parsed).not.toBeNull();
    const d = parseGeminiPayload(parsed!, "conv1", URL);
    expect(d!.messages).toHaveLength(2);
  });

  it("标题在 payload[0][2] meta", () => {
    const payload = JSON.stringify([[null, [
      [["c1", "r1"], null, [["问题"]], [[["rc_1", ["回答"]]]], {}, {}],
    ], [true, "BTC 直播部署", null, null, null, ["", "", ""], null, [1, "c1", "3.6 Flash"], true], "c1"]]);
    const block = JSON.stringify([["wrb.fr", "ujx1Bf", payload, null, null, null, "generic"]]);
    const text = `)]}'\n\n${block}`;
    const d = parseGeminiPayload(parseGeminiBatch(text)!, "c1", URL);
    expect(d!.title).toBe("BTC 直播部署");
  });
});

describe("kimi HYDRATION_INIT_STATE 解析", () => {
  it("BigInt/undefined 清洗 + think 块跳过", () => {
    const state = JSON.stringify({
      queries: [
        { queryKey: ["kimiPlusInfo", "", "zh-CN"], state: { data: null } },
        {
          queryKey: ["share", "share-1"],
          state: {
            data: {
              $typeName: "kimi.gateway.chat.v1.ChatShare",
              chat: { name: "谁是乔布斯" },
              messages: [
                { role: 2, blocks: [{ content: { case: "text", value: { content: "谁是乔布斯" } } }] },
                { role: 3, blocks: [
                  { content: { case: "think", value: { content: "这是一个知识问题" } } },
                  { content: { case: "text", value: { content: "史蒂夫·乔布斯是**苹果联合创始人**" } } },
                ] },
              ],
            },
          },
        },
      ],
    });
    // 模拟 JS 字面量：BigInt + undefined 注入
    const jsState = state.replace('"share-1"', '"share-1"').replace(/null, \{$/, "undefined, {").replace(
      '"kimiPlusInfo"',
      '"kimiPlusInfo"',
    ) + "";
    // 手工构造带 BigInt/undefined 的 JS 字面量
    const jsLiteral = state.replace('"dataUpdatedAt":0', '"dataUpdatedAt":BigInt("1786191562")').replace('"fetchStatus":"idle"', '"fetchStatus":"idle", "extra": undefined');
    const html = `<script>window.HYDRATION_INIT_STATE=${jsLiteral}</script>`;
    const d = parseKimiShare(html, "share-1", URL);
    expect(d).not.toBeNull();
    expect(d!.title).toBe("谁是乔布斯");
    expect(d!.messages).toHaveLength(2);
    expect(d!.messages[1].content).toContain("**苹果联合创始人**"); // think 块已跳过
    expect(d!.messages[1].content).not.toContain("这是一个知识问题");
  });
});

import { getPlatformRules } from "../src/collect";

describe("平台规则（单平台多域名）", () => {

  it("下发规则：chatgpt 多域名（chatgpt.com + chat.openai.com）共用一个 sharePattern", () => {
    const rules = getPlatformRules();
    const chatgpt = rules.find((r) => r.id === "chatgpt");
    expect(chatgpt).toBeTruthy();
    const re = new RegExp(chatgpt!.sharePattern);
    expect(re.test("https://chatgpt.com/share/abc-123")).toBe(true);
    expect(re.test("https://chat.openai.com/share/abc-123")).toBe(true);
    expect(re.test("https://claude.ai/share/abc-123")).toBe(false);
  });

  it("tongyi 平台多域名（qwen.aliyun.com + tongyi.aliyun.com）", () => {
    const rules = getPlatformRules();
    const tongyi = rules.find((r) => r.id === "tongyi");
    expect(tongyi).toBeTruthy();
    const re = new RegExp(tongyi!.sharePattern);
    expect(re.test("https://qwen.aliyun.com/share/abc123xyz")).toBe(true);
    expect(re.test("https://tongyi.aliyun.com/share/abc123xyz")).toBe(true);
  });

  it("perplexity 平台（/search/ 路径）", () => {
    const rules = getPlatformRules();
    const pplx = rules.find((r) => r.id === "perplexity");
    expect(pplx).toBeTruthy();
    const re = new RegExp(pplx!.sharePattern);
    expect(re.test("https://www.perplexity.ai/search/fan-yi-cheng-zhong-wen-4O_bpNVoTgSdr4hOzrrZ1w")).toBe(true);
    expect(re.test("https://perplexity.ai/search/abc-123")).toBe(true);
    expect(re.test("https://www.perplexity.ai/chat/abc-123")).toBe(false);
  });

  it("豆包路径前缀 /thread/ 保持", () => {
    const rules = getPlatformRules();
    const doubao = rules.find((r) => r.id === "doubao");
    const re = new RegExp(doubao!.sharePattern);
    expect(re.test("https://www.doubao.com/thread/abc123")).toBe(true);
    expect(re.test("https://www.doubao.com/share/abc123")).toBe(false);
  });
});

describe("perplexity 分享解析", () => {
  const URL = "https://www.perplexity.ai/search/fan-yi-cheng-zhong-wen-4O_bpNVoTgSdr4hOzrrZ1w";
  const ID = "fan-yi-cheng-zhong-wen-4O_bpNVoTgSdr4hOzrrZ1w";

  it("__NEXT_DATA__ 嵌入 JSON：深度提取 queries/answers + title", async () => {
    const { parsePerplexityShare } = await import("../src/platforms/perplexity");
    const nextData = JSON.stringify({
      props: { pageProps: { title: "翻译成中文" } },
      thread: {
        title: "翻译成中文",
        queries: ["翻译成中文：Hello world", "再翻译：Good morning"],
        answers: ["你好，世界", "早上好"],
      },
    });
    const html = `<html><head><title>翻译成中文 - Perplexity</title></head><body>
      <script id="__NEXT_DATA__" type="application/json">${nextData}</script>
      <div id="root"></div></body></html>`;
    const d = parsePerplexityShare(html, ID, URL);
    expect(d).not.toBeNull();
    expect(d!.title).toBe("翻译成中文");
    expect(d!.platform).toBe("perplexity");
    expect(d!.messages).toEqual([
      { role: "user", content: "翻译成中文：Hello world" },
      { role: "assistant", content: "你好，世界" },
      { role: "user", content: "再翻译：Good morning" },
      { role: "assistant", content: "早上好" },
    ]);
  });

  it("DOM 兜底：chat-turn-query + answer-content 按序提取", async () => {
    const { parsePerplexityShare } = await import("../src/platforms/perplexity");
    const html = `<html><head><title>翻译成中文 - Perplexity</title></head><body>
      <div data-testid="chat-turn-query"><div class="prose">翻译成中文：Hello world</div></div>
      <div data-testid="answer-content"><div class="prose"><p>你好，世界</p></div></div>
      <div data-testid="chat-turn-query"><div class="prose">再翻译：Good morning</div></div>
      <div data-testid="answer-content"><div class="prose"><p>早上好</p></div></div>
    </body></html>`;
    const d = parsePerplexityShare(html, ID, URL);
    expect(d).not.toBeNull();
    expect(d!.title).toBe("翻译成中文 - Perplexity");
    expect(d!.messages).toHaveLength(4);
    expect(d!.messages[0]).toMatchObject({ role: "user", content: expect.stringContaining("Hello world") });
    expect(d!.messages[1]).toMatchObject({ role: "assistant", content: expect.stringContaining("你好，世界") });
    expect(d!.messages[3]).toMatchObject({ role: "assistant", content: expect.stringContaining("早上好") });
  });

  it("无 assistant 消息/无结构 → null", async () => {
    const { parsePerplexityShare } = await import("../src/platforms/perplexity");
    expect(parsePerplexityShare("<html><body>普通页面</body></html>", ID, URL)).toBeNull();
  });
});
