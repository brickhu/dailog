import { describe, expect, it } from "vitest";
import { mergeMessageNodes, messageText, type MessageNode } from "../../src/content/core";
import { buildManualDialogue } from "../../src/content/collector";

const mk = (id: string, offsetTop: number, role: MessageNode["role"], content?: string): MessageNode => ({
  id,
  offsetTop,
  role,
  content: content ?? `${id}-content`,
});

describe("mergeMessageNodes（步进截取合并：自下而上，新节点前插）", () => {
  it("同 id 重读替换最新读数且保持原位置", () => {
    const acc = [mk("m1", 0, "user"), mk("m2", 100, "assistant")];
    mergeMessageNodes(acc, [mk("m2", 999, "assistant", "新内容")]);
    expect(acc.map((n) => n.id)).toEqual(["m1", "m2"]); // 位置不变
    expect(acc[1].content).toBe("新内容");
  });

  it("新节点前插（步进向上：新内容在已采内容上方），单轮读取内保持文档序", () => {
    const acc = [mk("m1", 0, "user")];
    mergeMessageNodes(acc, [mk("m2", 100, "assistant"), mk("m3", 200, "user")]);
    mergeMessageNodes(acc, [mk("m4", 300, "assistant")]);
    expect(acc.map((n) => n.id)).toEqual(["m4", "m2", "m3", "m1"]);
  });

  it("序列 id（rule-N 窗口下标）跨窗口按内容键累积——chatgpt 虚拟列表步进采集", () => {
    // 底部窗口：q1/a1/q2/a2（rule-0..3）；向上一步后窗口上移：a1/q2/a2/q3（rule-0..3 下标全变）
    const acc: MessageNode[] = [];
    mergeMessageNodes(acc, [
      mk("rule-0", 0, "user", "q1"),
      mk("rule-1", 100, "assistant", "a1"),
      mk("rule-2", 200, "user", "q2"),
      mk("rule-3", 300, "assistant", "a2"),
    ]);
    mergeMessageNodes(acc, [
      mk("rule-0", 0, "assistant", "a1"),
      mk("rule-1", 100, "user", "q2"),
      mk("rule-2", 200, "assistant", "a2"),
      mk("rule-3", 300, "user", "q3"),
    ]);
    // 已见消息原位替换，新内容（q3 在更上方）前插 → 对话顺序（顶→底）
    expect(acc.map((n) => n.content)).toEqual(["q3", "q1", "a1", "q2", "a2"]);
    expect(acc.map((n) => n.role)).toEqual(["user", "user", "assistant", "user", "assistant"]);
  });

  it("稳定 id（data-message-id）重复内容不按内容键合并——合法重复保留", () => {
    const acc: MessageNode[] = [mk("m1", 0, "user", "继续"), mk("m2", 100, "assistant", "好的")];
    mergeMessageNodes(acc, [mk("m3", 200, "user", "继续")]); // 相同内容、不同 id
    expect(acc.length).toBe(3);
  });

  it("降级保护：新内容为旧内容严格前缀（骨架/截断重渲染）→ 保留更完整的旧内容", () => {
    const acc: MessageNode[] = [mk("m1", 0, "user", "完整的长内容 ABCDEF")];
    mergeMessageNodes(acc, [mk("m1", 0, "user", "完整的长内容 AB")]); // 截断中间态
    expect(acc[0].content).toBe("完整的长内容 ABCDEF");
    // 正常内容更新（变长/不同）仍替换
    mergeMessageNodes(acc, [mk("m1", 0, "user", "更新后的完整内容")]);
    expect(acc[0].content).toBe("更新后的完整内容");
  });
});

describe("messageText（渲染文本 = 用户全选该消息所见）", () => {
  it("Range 选区提取元素文本", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>问题一</p><p>回答一</p>";
    expect(messageText(el)).toContain("问题一");
    expect(messageText(el)).toContain("回答一");
  });

  it("空元素返回空串（下游跳过）", () => {
    const el = document.createElement("div");
    expect(messageText(el)).toBe("");
  });
});

describe("buildManualDialogue（手动采集对话组装）", () => {
  const ctx = { root: document, url: "https://chat.deepseek.com/a/chat/s/conv1" };

  it("组装 platform/conversationId/title/messages（首见顺序）", async () => {
    document.title = "测试对话 · DeepSeek";
    // root 用 documentElement：ownerDocument.title 解析对话标题（document 自身 ownerDocument 为 null）
    const d = await buildManualDialogue(
      { root: document.documentElement, url: "https://chat.deepseek.com/a/chat/s/conv1" },
      [mk("m1", 0, "user", "你好"), mk("m2", 100, "assistant", "你好！")],
    );
    expect(d?.platform).toBe("deepseek");
    expect(d?.conversationId).toBe("conv1");
    expect(d?.title).toBe("测试对话");
    expect(d?.messages.map((m) => m.content)).toEqual(["你好", "你好！"]);
    expect(d?.lowConfidence).toBeUndefined();
  });

  it("缺助手回复（选择器失效）→ null", async () => {
    const d = await buildManualDialogue(ctx, [mk("m1", 0, "user", "你好")]);
    expect(d).toBeNull();
  });

  it("空节点 → null；未知主机 → null", async () => {
    expect(await buildManualDialogue(ctx, [])).toBeNull();
    expect(await buildManualDialogue({ ...ctx, url: "https://example.com/a/b" }, [mk("m1", 0, "user", "你好")])).toBeNull();
  });

  it("序列 id（rule-）内容相同：组装层不丢弃（合并层已按内容键去重，合法重复保留）", async () => {
    // 规则兜底路径：两条内容相同但确实是不同消息（如连续相同的追问）——
    // 变绿过的内容必须保留，不按内容去重
    const seq = [
      mk("rule-0", 0, "user", "继续"),
      mk("rule-1", 100, "assistant", "好的"),
      mk("rule-2", 200, "user", "继续"),
      mk("rule-3", 300, "assistant", "好的"),
    ];
    const d = await buildManualDialogue(ctx, seq);
    expect(d?.messages.map((m) => m.content)).toEqual(["继续", "好的", "继续", "好的"]);
    expect(d?.duplicatesRemoved).toBeUndefined();
  });

  it("getRules 提供的规则 conversationIdPattern 生效", async () => {
    const d = await buildManualDialogue(
      {
        root: document,
        url: "https://chatgpt.com/c/abc-123",
        getRules: async () => ({
          version: 8,
          platforms: {
            chatgpt: {
              userSelector: "[data-message-author-role='user']",
              assistantSelector: "[data-message-author-role='assistant']",
              url: { host: "chatgpt.com", conversationIdPattern: "c/([a-z0-9-]+)" },
            },
          },
        }),
      },
      [mk("m1", 0, "user", "q1"), mk("m2", 100, "assistant", "a1")],
    );
    expect(d?.platform).toBe("chatgpt");
    expect(d?.conversationId).toBe("abc-123");
  });
});
