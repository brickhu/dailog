import { describe, expect, it } from "vitest";
import { findShareUrl } from "../src/lib/clipboard";

// 剪贴板检测核心逻辑：从任意文本中提取受支持的分享链接（规则与 importer /platforms 同源）
const RULES = [
  { id: "claude", label: "Claude", sharePattern: "^https?:\\/\\/(www\\.)?claude\\.ai\\/share\\/[0-9a-f-]{36}" },
  { id: "deepseek", label: "DeepSeek", sharePattern: "^https?:\\/\\/chat\\.deepseek\\.com\\/share\\/[A-Za-z0-9]+" },
  { id: "chatgpt", label: "ChatGPT", sharePattern: "^https?:\\/\\/(www\\.)?(?:chatgpt\\.com|chat\\.openai\\.com)\\/share\\/[A-Za-z0-9-]+" },
  { id: "tongyi", label: "通义千问", sharePattern: "^https?:\\/\\/(www\\.)?(?:qwen\\.aliyun\\.com|tongyi\\.aliyun\\.com)\\/share\\/[A-Za-z0-9-]+" },
];

describe("findShareUrl（剪贴板链接提取）", () => {
  it("纯链接文本 → 命中", () => {
    expect(findShareUrl("https://chatgpt.com/share/abc-123", RULES)).toBe("https://chatgpt.com/share/abc-123");
  });

  it("链接混在正文中 → 提取第一个匹配", () => {
    const text = "看看这段对话：https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef 挺有意思的";
    expect(findShareUrl(text, RULES)).toBe("https://claude.ai/share/01234567-89ab-cdef-0123-456789abcdef");
  });

  it("多平台链接 → 返回第一个（按规则顺序）", () => {
    const text = "https://qwen.aliyun.com/share/abc https://chatgpt.com/share/x";
    expect(findShareUrl(text, RULES)).toBe("https://qwen.aliyun.com/share/abc");
  });

  it("无受支持链接 → null", () => {
    expect(findShareUrl("https://example.com/share/abc", RULES)).toBeNull();
    expect(findShareUrl("普通文本没有链接", RULES)).toBeNull();
  });

  it("同平台多域名（chatgpt + chat.openai.com）", () => {
    expect(findShareUrl("https://chat.openai.com/share/6a7af431", RULES)).toBe("https://chat.openai.com/share/6a7af431");
  });
});
