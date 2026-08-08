import { describe, expect, it, beforeEach } from "vitest";
import { installResponseSniff, findCapturedConversation, clearCapturedConversations } from "../../src/content/response-sniff";

beforeEach(() => {
  clearCapturedConversations();
});

describe("installResponseSniff（主世界回传捕获）", () => {
  it("幂等安装监听", () => {
    installResponseSniff();
    installResponseSniff();
  });

  it("页面 postMessage 对话数据 → findCapturedConversation 按 id 命中", () => {
    installResponseSniff();
    const url = "https://chatgpt.com/backend-api/conversation/abc-123";
    window.postMessage({ type: "dailog:conversation", url, data: { title: "t", mapping: { root: { children: [] } } } }, "*");
    // postMessage 异步送达
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const d = findCapturedConversation("abc-123");
        expect(d).toEqual({ title: "t", mapping: { root: { children: [] } } });
        resolve();
      }, 10);
    });
  });

  it("无匹配 id → null", () => {
    installResponseSniff();
    expect(findCapturedConversation("nope")).toBeNull();
  });
});
