import { describe, expect, it, vi } from "vitest";
import { runCollectFlow } from "../src/content/collect-flow";
import type { CollectResult, CollectedDialogue } from "../src/shared";

const dialogue: CollectedDialogue = {
  platform: "claude",
  conversationId: "c-1",
  title: "t",
  url: "https://claude.ai/chat/c-1",
  messages: [{ role: "user", content: "hi" }],
};

describe("runCollectFlow", () => {
  it("collects, sends MSG_COLLECT with dialogue, shows success", async () => {
    const send = vi.fn(async (): Promise<CollectResult> => ({ ok: true, dialogue }));
    const onResult = vi.fn();
    await runCollectFlow({ collect: async () => dialogue, send, onResult });
    expect(send).toHaveBeenCalledWith({ type: "dailogues:collect", dialogue });
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("已采集"), "success");
  });

  it("shows error when collect returns null", async () => {
    const send = vi.fn(async (): Promise<CollectResult | undefined> => undefined);
    const onResult = vi.fn();
    await runCollectFlow({ collect: async () => null, send, onResult });
    expect(send).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("未识别到对话内容"), "error");
  });

  it("shows backend error message when send fails", async () => {
    const send = vi.fn(async (): Promise<CollectResult> => ({ ok: false, error: "no_token" }));
    const onResult = vi.fn();
    await runCollectFlow({ collect: async () => dialogue, send, onResult });
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("no_token"), "error");
  });

  it("surfaces thrown errors", async () => {
    const send = vi.fn(async (): Promise<CollectResult> => { throw new Error("boom"); });
    const onResult = vi.fn();
    await runCollectFlow({ collect: async () => dialogue, send, onResult });
    expect(onResult).toHaveBeenCalledWith(expect.stringContaining("boom"), "error");
  });
});
