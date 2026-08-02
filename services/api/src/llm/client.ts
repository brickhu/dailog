export interface LlmMessage { role: "user" | "assistant" | "system"; content: string; }

export interface LlmClient {
  /** 非流式补全，返回 content 文本 */
  complete(messages: LlmMessage[]): Promise<string>;
  /** 流式补全，逐 delta 回调（SSE） */
  stream(messages: LlmMessage[], onDelta: (delta: string) => void): Promise<string>;
}

export interface LlmOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export function createLlmClient(opts: LlmOptions): LlmClient {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl}/chat/completions`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };

  async function complete(messages: LlmMessage[]): Promise<string> {
    const res = await f(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model, messages, stream: false }),
    });
    if (!res.ok) throw new Error(`llm http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]?.message?.content ?? "";
  }

  async function stream(messages: LlmMessage[], onDelta: (delta: string) => void): Promise<string> {
    const res = await f(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: opts.model, messages, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`llm http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    const processLine = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload) as { choices: { delta: { content?: string } }[] };
        const delta = json.choices[0]?.delta?.content ?? "";
        if (delta) { full += delta; onDelta(delta); }
      } catch { /* 忽略无法解析的 chunk */ }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    }
    // flush：最后一段 data: 行可能没有结尾换行，直接按一行处理，避免末尾 delta 静默丢失
    if (buffer.length > 0) processLine(buffer);
    return full;
  }

  return { complete, stream };
}
