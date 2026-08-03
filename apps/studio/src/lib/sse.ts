/** SSE 消费（fetch 流式；EventSource 无法带 Authorization 头，故自解析） */

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseHandlers {
  onEvent?: (ev: SseEvent) => void;
  onDone?: (data: string) => void;
  onError?: (data: string) => void;
  signal?: AbortSignal;
}

/**
 * 消费 SSE Response 直到流结束。非 2xx 抛错；流中断抛错。
 * 事件边界 = 空行；data 多行按标准以 \n 拼接；兼容 CRLF。
 */
export async function consumeSse(res: Response, handlers: SseHandlers): Promise<void> {
  if (!res.ok || !res.body) throw new Error(`SSE http_${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let dataLines: string[] = [];

  const flush = () => {
    if (eventName && dataLines.length > 0) {
      const ev: SseEvent = { event: eventName, data: dataLines.join("\n") };
      if (ev.event === "done") handlers.onDone?.(ev.data);
      else if (ev.event === "error") handlers.onError?.(ev.data);
      else handlers.onEvent?.(ev);
    }
    eventName = "";
    dataLines = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 按空行切事件；行尾统一剥掉 \r
    let boundary = buffer.indexOf("\n\n");
    let boundary2 = buffer.indexOf("\r\n\r\n");
    while (boundary !== -1 || boundary2 !== -1) {
      const cut = boundary2 !== -1 && (boundary === -1 || boundary2 < boundary) ? boundary2 : boundary;
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of block.split("\n")) {
        const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (clean.startsWith("event:")) eventName = clean.slice(6).trim();
        else if (clean.startsWith("data:")) dataLines.push(clean.slice(5).trimStart());
      }
      flush();
      boundary = buffer.indexOf("\n\n");
      boundary2 = buffer.indexOf("\r\n\r\n");
    }
  }
  flush(); // 流结束时的尾块
  reader.releaseLock();
}
