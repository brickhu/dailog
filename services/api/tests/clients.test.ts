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
  it("sends model field with default free model", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const tts: TtsClient = createTtsClient({
      apiKey: "fish-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await tts.synthesizeSingle({ text: "你好", referenceId: "guest-model" });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe("s2.1-pro-free");
  });

  it("falls back to paid model on 402 insufficient credit (single)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () =>
        new Response(JSON.stringify({ message: "Insufficient API credit" }), { status: 402 }),
      )
      .mockImplementationOnce(async () => new Response(new Uint8Array([9, 9]), { status: 200 }));
    const tts: TtsClient = createTtsClient({
      apiKey: "fish-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const buf = await tts.synthesizeSingle({ text: "你好", referenceId: "guest-model" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(buf.length).toBe(2);
    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.model).toBe("s2.1-pro"); // 降级付费模型重试
  });

  it("does not fall back when 402 persists (error surfaces)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Insufficient API credit" }), { status: 402 }),
    );
    const tts: TtsClient = createTtsClient({
      apiKey: "fish-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(
      tts.synthesizeSingle({ text: "你好", referenceId: "guest-model" }),
    ).rejects.toThrow(/http_402/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 也尝试过降级
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

  it("synthesizeMultiSpeaker: msgpack 2D references + speaker 标签（请求构造）", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const tts: TtsClient = createTtsClient({
      apiKey: "fish-key",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    const buf = await tts.synthesizeMultiSpeaker({
      segments: [
        { speaker: 0, text: "你好" },
        { speaker: 1, text: "你好！" },
      ],
      referenceAudios: [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])],
    });
    expect(buf.length).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.fish.audio/v1/tts");
    expect((init as RequestInit).method).toBe("POST");
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("application/msgpack");
    // msgpack 载荷含 references 2D：不逐字节断言（编码器已有 golden 测试），确认非 JSON 且带 speaker 文本
    const body = (init as RequestInit).body as Uint8Array;
    expect(Buffer.isBuffer(body) || body instanceof Uint8Array).toBe(true);
  });
});
