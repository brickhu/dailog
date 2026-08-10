import { describe, expect, it } from "vitest";
import { polishPrompt } from "../src/llm/prompts";

const msgs = [{ role: "user", content: "你好" }, { role: "assistant", content: "你好！" }];

describe("polishPrompt 嘉宾信息注入", () => {
  it("有 intro：注入嘉宾信息段（名称/背景/开场引导）", () => {
    const [sys] = polishPrompt(msgs, null, { hostName: "小明", aiName: "Claude", aiIntro: "Anthropic 的 AI 助手" });
    expect(sys.content).toContain("5.5 嘉宾信息");
    expect(sys.content).toContain("名称：Claude");
    expect(sys.content).toContain("背景：Anthropic 的 AI 助手");
    expect(sys.content).toContain("我是 Claude，Anthropic 的 AI 助手…");
    // 风格由对话提炼，不硬编码人设
    expect(sys.content).toContain("不要套用与对话内容不符的人设");
  });

  it("intro 超长截断（≤200）", () => {
    const [sys] = polishPrompt(msgs, null, { aiName: "X", aiIntro: "很长的背景介绍".repeat(60) });
    expect(sys.content).toContain("背景：" + "很长的背景介绍".repeat(25));
  });

  it("hostPersona：注入主持人风格段（性格是遵循的风格要求）", () => {
    const [sys] = polishPrompt(msgs, null, {
      hostName: "小明",
      aiName: "Claude",
      hostPersona: "称呼：小明；性格：风趣幽默，雷厉风行",
    });
    expect(sys.content).toContain("5.6 主持人风格");
    expect(sys.content).toContain("性格：风趣幽默，雷厉风行");
    expect(sys.content).toContain("全篇主持人的语气、节奏、用词遵循此风格");
  });

  it("无 hostPersona：不注入主持人风格段", () => {
    const [sys] = polishPrompt(msgs, null, { hostName: "小明" });
    expect(sys.content).not.toContain("5.6 主持人风格");
  });

  it("无 intro（未映射平台）：不注入嘉宾信息段（降级）", () => {
    const [sys] = polishPrompt(msgs, null, { hostName: "小明", aiName: "AI 嘉宾" });
    expect(sys.content).not.toContain("5.5 嘉宾信息");
    expect(sys.content).not.toContain("嘉宾信息（对话中的 AI 平台）");
  });

  it("完全缺省 meta：与旧行为一致", () => {
    const [sys] = polishPrompt(msgs);
    expect(sys.content).not.toContain("5.5");
    expect(sys.content).toContain("主持人");
  });
});
