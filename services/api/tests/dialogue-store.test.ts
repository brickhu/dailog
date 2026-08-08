import { describe, expect, it } from "vitest";
import { writeDialogue, readDialogue, mergeDialogue } from "../src/dialogue-store";
import type { AudioStorage } from "../src/storage";

/** 内存存储 fake（真实 R2 语义：put 覆盖、get 读回） */
function memStorage(): AudioStorage & { dump: () => Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    put: async (key, data) => { map.set(key, data); },
    get: async (key) => {
      const v = map.get(key);
      if (!v) throw new Error("not found");
      return v;
    },
    delete: async (key) => { map.delete(key); },
    dump: () => map,
  };
}

const base = {
  platform: "claude" as const,
  conversationId: "c-1",
  title: "对话",
  url: "https://claude.ai/chat/c-1",
};

describe("mergeDialogue（重复采集内容比对合并）", () => {
  it("内容一致 → 追加 0 条，不写存储", async () => {
    const storage = memStorage();
    await writeDialogue(storage, "imp-1", {
      ...base,
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    });
    const n = await mergeDialogue(storage, "imp-1", {
      ...base,
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    });
    expect(n).toBe(0);
    const stored = await readDialogue(storage, "imp-1");
    expect(stored!.messages).toHaveLength(2);
  });

  it("有新消息 → 追加到末尾（按内容去重），返回追加条数", async () => {
    const storage = memStorage();
    await writeDialogue(storage, "imp-1", {
      ...base,
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
    });
    const n = await mergeDialogue(storage, "imp-1", {
      ...base,
      messages: [
        { role: "user", content: "hi" },           // 重复
        { role: "assistant", content: "hello" },   // 重复
        { role: "user", content: "第二问" },        // 新增
        { role: "assistant", content: "第二答" },   // 新增
      ],
    });
    expect(n).toBe(2);
    const stored = await readDialogue(storage, "imp-1");
    expect(stored!.messages.map((m) => m.content)).toEqual(["hi", "hello", "第二问", "第二答"]);
  });

  it("原对话缺失 → 保守不写，返回 0", async () => {
    const storage = memStorage();
    const n = await mergeDialogue(storage, "missing", { ...base, messages: [{ role: "user", content: "x" }] });
    expect(n).toBe(0);
  });

  it("新采集标题/URL 非空时更新（早期版本可能没采到标题）", async () => {
    const storage = memStorage();
    await writeDialogue(storage, "imp-1", {
      ...base,
      title: "",
      messages: [{ role: "user", content: "hi" }],
    });
    await mergeDialogue(storage, "imp-1", {
      ...base,
      title: "新标题",
      url: "https://claude.ai/chat/c-1",
      messages: [{ role: "user", content: "hi" }, { role: "user", content: "new" }],
    });
    const stored = await readDialogue(storage, "imp-1");
    expect(stored!.title).toBe("新标题");
    expect(stored!.messages).toHaveLength(2);
  });
});
