import { describe, expect, it } from "vitest";
import { collectShareUrl } from "../src/collect";

// URL 校验测试：只测校验层（不实际采集——合法链接会走到网络，用 mock 不现实，
// 这里验证的是"哪些 URL 被拒绝、以什么错误拒绝"）
describe("URL 校验（平台分享页结构）", () => {
  it("非 http(s) → invalid_url", async () => {
    const r = await collectShareUrl("ftp://claude.ai/share/xxx");
    expect("error" in r && r.error).toBe("invalid_url");
  });

  it("完全无关域名 → unsupported_platform", async () => {
    const r = await collectShareUrl("https://example.com/foo");
    expect("error" in r && r.error).toBe("unsupported_platform");
  });

  it("平台对话页（非分享页）→ unsupported_platform", async () => {
    const r = await collectShareUrl("https://claude.ai/chat/abc123");
    expect("error" in r && r.error).toBe("unsupported_platform");
  });

  it("分享页缺 id → invalid_url（不是 parse_failed）", async () => {
    const r = await collectShareUrl("https://claude.ai/share/");
    expect("error" in r && r.error).toBe("invalid_url");
  });

  it("分享 id 格式非法 → invalid_url", async () => {
    const r = await collectShareUrl("https://claude.ai/share/not-a-uuid");
    expect("error" in r && r.error).toBe("invalid_url");
  });

  it("伪装域名（路径含 claude.ai/share）→ unsupported_platform", async () => {
    const r = await collectShareUrl("https://evil.com/claude.ai/share/6cc0f373-72c5-4afd-a223-98471688e736");
    expect("error" in r && r.error).toBe("unsupported_platform");
  });

  it("近似域名（claude.ai.evil.com）→ unsupported_platform", async () => {
    const r = await collectShareUrl("https://claude.ai.evil.com/share/6cc0f373-72c5-4afd-a223-98471688e736");
    expect("error" in r && r.error).toBe("unsupported_platform");
  });

  it("www 子域 + 合法 UUID → 通过校验（不是校验类拒绝）", async () => {
    const r = await collectShareUrl("https://www.claude.ai/share/6cc0f373-72c5-4afd-a223-98471688e736");
    const err = "error" in r ? r.error : null;
    expect(err).not.toBe("invalid_url");
    expect(err).not.toBe("unsupported_platform");
  });

  it("deepseek 合法分享 id → 通过校验（不是校验类拒绝）", async () => {
    const r = await collectShareUrl("https://chat.deepseek.com/share/95z1fr6y7rj4q5nmd0");
    const err = "error" in r ? r.error : null;
    expect(err).not.toBe("invalid_url");
    expect(err).not.toBe("unsupported_platform");
  });

  it("kimi 非 UUID id → invalid_url", async () => {
    const r = await collectShareUrl("https://www.kimi.com/share/not-a-uuid");
    expect("error" in r && r.error).toBe("invalid_url");
  });
});
