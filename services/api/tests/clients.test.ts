import { describe, expect, it, vi } from "vitest";
import { createLlmClient, type LlmClient } from "../src/llm/client";
import { createTtsClient, type TtsClient } from "../src/tts/client";
import { createStorage, type AudioStorage } from "../src/storage";
import { msgpackEncode } from "../src/tts/msgpack";

function fakeFetch() {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("llm client", () => {
  it("calls OpenAI-compatible chat completions", async () => {
    const fetchMock = fakeFetch();
    const llm: LlmClient = createLlmClient({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const out = await llm.complete([{ role: "user", content: "hi" }]);
    expect(out).toBe('{"ok":true}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer sk-test" });
  });

  it("streams SSE deltas across chunk boundaries and flushes trailing line", async () => {
    // 在 "你"（E4 BD A0）的第二个字节处切开字节流：多字节字符跨 chunk 边界；
    // 第二个 chunk 在 data: 行中间断开（部分行）；末尾 data: [DONE] 无结尾换行（触发 buffer flush）
    const payload =
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n' +
      'data: {"choices":[{"delta":{"content":"，世界"}}]}\n' +
      "data: [DONE]";
    const bytes = new TextEncoder().encode(payload);
    const cut = bytes.indexOf(0xbd); // "你" 的第二字节
    const chunks = [bytes.slice(0, cut), bytes.slice(cut, cut + 6), bytes.slice(cut + 6)];
    let i = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (i < chunks.length) controller.enqueue(chunks[i++]);
          else controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const llm: LlmClient = createLlmClient({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const deltas: string[] = [];
    const full = await llm.stream([{ role: "user", content: "hi" }], (d) => deltas.push(d));
    expect(full).toBe("你好，世界");
    expect(deltas.join("")).toBe("你好，世界");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({ stream: true });
  });
});

describe("tts client", () => {
  it("builds multi-speaker request with speaker tags", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const tts: TtsClient = createTtsClient({
      apiKey: "fish-key",
      proxyUrl: undefined,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const buf = await tts.synthesizeMultiSpeaker({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
      ],
      referenceIds: ["host-model", "guest-model"],
    });
    expect(buf.length).toBe(3);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.text).toContain("<|speaker:0|>");
    expect(body.reference_id).toEqual(["host-model", "guest-model"]);
  });

  it("msgpack references encode to spike-verified golden bytes", () => {
    // golden hex 与 scripts/spikes/fish-audio.mjs 的 msgpackEncode 输出字节级一致
    const buf = msgpackEncode({
      text: "你好",
      references: [{ audio: new Uint8Array([1, 2, 3]), text: "参考" }],
      format: "mp3",
    });
    expect(Buffer.from(buf).toString("hex")).toBe(
      "83a474657874a6e4bda0e5a5bdaa7265666572656e6365739182" +
        "a5617564696fc403010203a474657874a6e58f82e88083a6666f726d6174a36d7033",
    );
    // 边界：40 字串 → str8(0xd9)，300 字节音频 → bin16(0xc5)
    const buf2 = msgpackEncode({
      text: "x".repeat(40),
      references: [{ audio: new Uint8Array(300).fill(7), text: "t".repeat(40) }],
      format: "mp3",
    });
    expect(Buffer.from(buf2).toString("hex")).toBe(
      "83a474657874d928" + "78".repeat(40) + "aa7265666572656e6365739182a5617564696f" +
        "c5012c" + "07".repeat(300) + "a474657874d928" + "74".repeat(40) +
        "a6666f726d6174a36d7033",
    );
  });

  it("rejects referenceAudio + referenceId together", async () => {
    const tts: TtsClient = createTtsClient({ apiKey: "fish-key" });
    await expect(
      tts.synthesizeSingle({ text: "hi", referenceAudio: new Uint8Array([1]), referenceId: "m" }),
    ).rejects.toThrow(/referenceAudio/);
  });
});

describe("storage", () => {
  it("fs driver writes and reads", async () => {
    const storage: AudioStorage = createStorage({ driver: "fs", dir: "./data-test" });
    await storage.put("episodes/u1/e1.mp3", new Uint8Array([9, 9]));
    const buf = await storage.get("episodes/u1/e1.mp3");
    expect([...buf]).toEqual([9, 9]);
  });

  it("fs driver rejects path traversal keys", async () => {
    const storage: AudioStorage = createStorage({ driver: "fs", dir: "./data-test" });
    await expect(storage.put("../evil.mp3", new Uint8Array([1]))).rejects.toThrow(/invalid storage key/);
    await expect(storage.get("../../etc/passwd")).rejects.toThrow(/invalid storage key/);
  });
});
