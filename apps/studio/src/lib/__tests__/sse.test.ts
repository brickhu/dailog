import { describe, expect, it } from "vitest";
import { consumeSse } from "../sse";

/** 构造 SSE 流式 Response（按 chunks 切分模拟网络分片） */
function sseResponse(events: Array<{ event: string; data: string }>, chunks: number[] = []): Response {
  const text = events.map((e) => `event: ${e.event}\ndata: ${e.data}\n\n`).join("");
  // 按字节切分（默认整块）
  const parts: Uint8Array[] = [];
  let offset = 0;
  const sizes = chunks.length > 0 ? chunks : [text.length];
  for (const size of sizes) {
    parts.push(new TextEncoder().encode(text.slice(offset, offset + size)));
    offset += size;
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("consumeSse", () => {
  it("dispatches segment events then done, in order, across chunk boundaries", async () => {
    const seen: string[] = [];
    await consumeSse(
      sseResponse(
        [
          { event: "segment", data: "你" },
          { event: "segment", data: "好" },
          { event: "done", data: '{"version":3}' },
        ],
        [5, 7, 100], // 让 event 头/数据跨 chunk 边界
      ),
      {
        onEvent: (ev) => {
          if (ev.event === "segment") seen.push(ev.data);
        },
        onDone: (data) => seen.push(`done:${data}`),
      },
    );
    expect(seen).toEqual(["你", "好", "done:{\"version\":3}"]);
  });

  it("reports error event data", async () => {
    let errorData: string | null = null;
    await consumeSse(
      sseResponse([{ event: "error", data: '{"error":"quality_rejected"}' }]),
      { onError: (data) => { errorData = data; } },
    );
    expect(errorData).toBe('{"error":"quality_rejected"}');
  });

  it("rejects on non-200 response", async () => {
    const res = new Response("boom", { status: 500 });
    await expect(consumeSse(res, {})).rejects.toThrow(/500/);
  });

  it("rejects when stream errors mid-way", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: segment\nda"));
        controller.error(new Error("network reset"));
      },
    });
    await expect(consumeSse(new Response(stream, { status: 200 }), {})).rejects.toThrow(/network reset/);
  });

  it("concatenates multi-line data fields (CRLF too)", async () => {
    const seen: string[] = [];
    // 模拟 CRLF 行结束 + 多行 data（标准 SSE 规定 data 多行以 \n 拼接）
    const raw = "event: segment\r\ndata: line1\r\ndata: line2\r\n\r\nevent: done\r\ndata: ok\r\n\r\n";
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(raw));
        c.close();
      },
    });
    await consumeSse(new Response(stream, { status: 200 }), {
      onEvent: (ev) => { if (ev.event === "segment") seen.push(ev.data); },
      onDone: (data) => seen.push(`done:${data}`),
    });
    expect(seen).toEqual(["line1\nline2", "done:ok"]);
  });
});
