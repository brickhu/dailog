import { describe, expect, it } from "vitest";
import { mergeMessageNodes, messageText, type MessageNode } from "../../src/content/core";
import { buildManualDialogue } from "../../src/content/collector";

const mk = (id: string, offsetTop: number, role: MessageNode["role"], content?: string): MessageNode => ({
  id,
  offsetTop,
  role,
  content: content ?? `${id}-content`,
});

describe("mergeMessageNodes（手动采集合并：按 id 替换/追加，首见顺序）", () => {
  it("同 id 重读替换最新读数且保持原位置", () => {
    const acc = [mk("m1", 0, "user"), mk("m2", 100, "assistant")];
    mergeMessageNodes(acc, [mk("m2", 999, "assistant", "新内容")]);
    expect(acc.map((n) => n.id)).toEqual(["m1", "m2"]); // 位置不变
    expect(acc[1].content).toBe("新内容");
  });

  it("新节点追加，首见顺序 = 对话顺序", () => {
    const acc = [mk("m1", 0, "user")];
    mergeMessageNodes(acc, [mk("m2", 100, "assistant"), mk("m3", 200, "user")]);
    mergeMessageNodes(acc, [mk("m4", 300, "assistant")]);
    expect(acc.map((n) => n.id)).toEqual(["m1", "m2", "m3", "m4"]);
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

  it("序列 id（rule-）同内容去重 → duplicatesRemoved，稳定 id 重复内容保留", async () => {
    // doubao 场景：用户重复问「继续」是合法内容，稳定 id（data-message-id）必须保留
    const stable = [
      mk("m1", 0, "user", "继续"),
      mk("m2", 100, "assistant", "好的"),
      mk("m3", 200, "user", "继续"),
      mk("m4", 300, "assistant", "好的"),
    ];
    const d1 = await buildManualDialogue(ctx, stable);
    expect(d1?.messages.map((m) => m.content)).toEqual(["继续", "好的", "继续", "好的"]);
    expect(d1?.duplicatesRemoved).toBeUndefined();
    // 规则兜底（rule-N 序列 id）：虚拟列表不同窗口下标变化 → 同内容跨窗口重复，需去重
    const seq = [
      mk("rule-0", 0, "user", "q1"),
      mk("rule-1", 100, "assistant", "a1"),
      mk("rule-0", 0, "user", "q1"),
      mk("rule-2", 200, "assistant", "a1"),
    ];
    const d2 = await buildManualDialogue(ctx, seq);
    expect(d2?.messages.map((m) => m.content)).toEqual(["q1", "a1"]);
    expect(d2?.duplicatesRemoved).toBe(2);
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
