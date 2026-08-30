// 最小 OpenAI 兼容 chat/completions 客户端（流式 SSE；零依赖，Node 22+ 原生 fetch）
// 接口与 services/api 计划的 createLlmClient 对齐：complete(messages) → 全文

/** 流式或一次性调用，返回完整回复文本；onDelta 收到增量（默认打印到 stdout） */
export async function complete(config, messages, { stream = true, onDelta, signal, onUsage } = {}) {
  const body = {
    model: config.model,
    messages,
    stream,
    temperature: config.temperature,
  };
  if (config.maxTokens) body.max_tokens = config.maxTokens;
  if (config.seed !== undefined) body.seed = config.seed; // 可复现性（provider 支持时生效；不支持会忽略或报错，去掉即可）

  let res;
  try {
    res = await fetch(config.baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw new Error("[llm] 请求失败：" + e.message + "（base-url=" + config.baseUrl + "，检查网络/代理）");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("[llm] " + config.baseUrl + "/chat/completions → " + res.status + ": " + text.slice(0, 400));
  }

  if (!stream) {
    const data = await res.json();
    if (onUsage && data?.usage) onUsage(data.usage);
    return data?.choices?.[0]?.message?.content ?? "";
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("[llm] 响应无 body");
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          if (onDelta) onDelta(delta);
        }
      } catch {
        /* 忽略 keep-alive / 非 JSON 行 */
      }
    }
  }
  return full;
}