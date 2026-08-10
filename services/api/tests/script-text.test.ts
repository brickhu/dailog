import { describe, expect, it } from "vitest";
import { stripEmotionTags, stripSegmentTexts, segmentsToSubtitle } from "../src/lib/script-text";

describe("stripEmotionTags（对外只暴露纯文本）", () => {
  it("去掉情绪/停顿/音效标签", () => {
    expect(stripEmotionTags("[happy] 欢迎回来 [break] 今天我们聊点干货")).toBe("欢迎回来 今天我们聊点干货");
    expect(stripEmotionTags("[very excited][laughing] 太棒了！")).toBe("太棒了！");
    expect(stripEmotionTags("[slightly sad] 唉 [long-break] 有点遗憾")).toBe("唉 有点遗憾");
  });

  it("无标签原样返回", () => {
    expect(stripEmotionTags("普通台词")).toBe("普通台词");
  });

  it("stripSegmentTexts 保留 speaker", () => {
    expect(stripSegmentTexts([
      { speaker: "host", text: "[happy] 你好" },
      { speaker: "guest", text: "[calm] 你好！" },
    ])).toEqual([
      { speaker: "host", text: "你好" },
      { speaker: "guest", text: "你好！" },
    ]);
  });

  it("segmentsToSubtitle 拼接字幕", () => {
    expect(segmentsToSubtitle([{ text: "[happy] 第一句" }, { text: "第二句" }])).toBe("第一句\n第二句");
  });
});
