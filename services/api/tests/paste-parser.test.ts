import { describe, expect, it } from "vitest";
import { parsePasteText } from "../src/lib/paste-parser";

describe("parsePasteText（手动粘贴对话解析）", () => {
  it("ChatGPT 复制格式（You:/ChatGPT: 标记）", () => {
    const text = `You:
帮我翻译这句话：Hello world

ChatGPT:
你好，世界。这是一句简单的英文问候语。

You:
再翻译 Good morning

ChatGPT:
早上好。`;
    const msgs = parsePasteText(text);
    expect(msgs).not.toBeNull();
    expect(msgs).toHaveLength(4);
    expect(msgs![0]).toMatchObject({ role: "user", content: expect.stringContaining("Hello world") });
    expect(msgs![1]).toMatchObject({ role: "assistant", content: expect.stringContaining("你好，世界") });
    expect(msgs![3]).toMatchObject({ role: "assistant", content: expect.stringContaining("早上好") });
  });

  it("Claude 复制格式（Human:/Assistant:）", () => {
    const text = `Human:
裸辞去创业值得吗？

Assistant:
这个问题没有标准答案，但可以从风险承受和现金流两个角度拆解。`;
    const msgs = parsePasteText(text);
    expect(msgs).not.toBeNull();
    expect(msgs![0].role).toBe("user");
    expect(msgs![1].role).toBe("assistant");
    expect(msgs![1].content).toContain("现金流");
  });

  it("中文标记（问：/答：）", () => {
    const text = `问：
AI 会取代程序员吗？

答：
短期不会，长期会改变程序员的职责边界。`;
    const msgs = parsePasteText(text);
    expect(msgs![0].role).toBe("user");
    expect(msgs![1].role).toBe("assistant");
  });

  it("无标记 → 空行分段交替（首段 user）", () => {
    const text = `第一段：谈谈你对 AI 的看法，这个话题最近很热门，我想听听你的观点。

第二段：AI 是工具不是对手，关键在于人怎么用。`;
    const msgs = parsePasteText(text);
    expect(msgs).not.toBeNull();
    expect(msgs).toHaveLength(2);
    expect(msgs![0].role).toBe("user");
    expect(msgs![1].role).toBe("assistant");
  });

  it("内容过短/无法解析 → null", () => {
    expect(parsePasteText("只有一句话")).toBeNull();
    expect(parsePasteText("")).toBeNull();
  });

  it("正文含 'AI:' 开头的长句不误判为标记", () => {
    const text = `AI: 这句话虽然以 AI 开头但它是正文内容，不是说话人标记，因为太长了。`;
    // 无标记 → 单段 → 无法产出双角色 → null
    expect(parsePasteText(text)).toBeNull();
  });
});
