import { describe, expect, it, beforeEach } from "vitest";
import { installResponseSniff, findCapturedConversation, clearCapturedConversations } from "../../src/content/response-sniff";

beforeEach(() => {
  clearCapturedConversations();
});

describe("installResponseSniff（主世界拦截安装 + 回传捕获）", () => {
  it("注入 script[data-dailog-sniff]（幂等）", () => {
    document.head.innerHTML = "";
    installResponseSniff();
    expect(document.querySelector("script[data-dailog-sniff]")).not.toBeNull();
    installResponseSniff(); // 幂等
    expect(document.querySelectorAll("script[data-dailog-sniff]").length).toBe(1);
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
