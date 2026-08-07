import { describe, expect, it, vi } from "vitest";
import { runCollectFlow } from "../src/content/collect-flow";
import type { CollectedDialogue, CacheCollectResult } from "../src/shared";

const dialogue: CollectedDialogue = {
  platform: "claude",
  conversationId: "c-1",
  title: "t",
  url: "https://claude.ai/chat/c-1",
  messages: [{ role: "user", content: "hi" }],
};

const opts = (overrides: Partial<Parameters<typeof runCollectFlow>[0]> = {}) => ({
  collect: async (): Promise<CollectedDialogue | null> => dialogue,
  cache: async (): Promise<CacheCollectResult> => ({ ok: true, collectId: "uuid-1", appUrl: "https://app.dailog.fm/import?collectId=uuid-1" }),
  onResult: vi.fn(),
  ...overrides,
});

describe("runCollectFlow（采集 → 缓存，无鉴权预检）", () => {
  it("采集 → 缓存 → 成功提示", async () => {
    const collect = vi.fn(async () => dialogue);
    const cache = vi.fn(async (): Promise<CacheCollectResult> => ({ ok: true, collectId: "uuid-1", appUrl: "u" }));
    const onResult = vi.fn();
    await runCollectFlow(opts({ collect, cache, onResult }));
    expect(collect).toHaveBeenCalledOnce();
    expect(cache).toHaveBeenCalledWith(dialogue);
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("已采集"), "success");
  });

  it("采集为空 → 提示，不缓存", async () => {
    const cache = vi.fn();
    const onResult = vi.fn();
    await runCollectFlow(opts({ collect: async () => null, cache, onResult }));
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("未识别到对话内容"), "error");
    expect(cache).not.toHaveBeenCalled();
  });

  it("缓存失败 → 错误提示", async () => {
    const cache = vi.fn(async (): Promise<CacheCollectResult> => ({ ok: false, error: "storage_full" }));
    const onResult = vi.fn();
    await runCollectFlow(opts({ cache, onResult }));
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("storage_full"), "error");
  });

  it("抛出异常 → 错误提示", async () => {
    const collect = vi.fn(async () => { throw new Error("boom"); });
    const onResult = vi.fn();
    await runCollectFlow(opts({ collect, onResult }));
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("boom"), "error");
  });

  it("扩展上下文失效 → 引导刷新页面", async () => {
    const collect = vi.fn(async () => { throw new Error("Extension context invalidated."); });
    const onResult = vi.fn();
    await runCollectFlow(opts({ collect, onResult }));
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("刷新本页面"), "error");
  });
});
