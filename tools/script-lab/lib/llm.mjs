// 最小 OpenAI 兼容 chat/completions 客户端（流式 SSE；零依赖，Node 22+ 原生 fetch）
// 接口与 services/api 计划的 createLlmClient 对齐：complete(messages) → 全文

/** camelCase → snake_case（maxTokens→max_tokens、topP→top_p、responseFormat→response_format…）；无大写则原样（thinking/seed/stop/tools/model…） */
function toApiParamKey(k) {
  return /[A-Z]/.test(k) ? k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase() : k;
}

/**
 * 组装 chat/completions 请求体：config 中除 messages 外的全部参数透传
 * （camelCase 自动转 snake_case；apiKey/baseUrl 为连接配置，永不入 body；thinking 等供应商扩展原样透传）
 * 运行时 opts（stream/tools/toolChoice）优先级高于 config 中的同名键。
 */
export function buildChatBody(config, messages, opts = {}) {
  const body = {};
  for (const [k, v] of Object.entries(config || {})) {
    if (v === undefined || v === null) continue;
    if (k === "messages" || k === "apiKey" || k === "baseUrl") continue;
    body[toApiParamKey(k)] = v;
  }
  body.messages = messages;
  if (opts.stream !== undefined) body.stream = opts.stream;
  else if (body.stream === undefined) body.stream = true;
  if (opts.tools !== undefined) body.tools = opts.tools;
  if (opts.toolChoice !== undefined) body.tool_choice = opts.toolChoice;
  return body;
}

/** 流式或一次性调用，返回完整回复文本；onDelta 收到增量（默认打印到 stdout） */
export async function complete(config, messages, { stream, onDelta, signal, onUsage, tools, toolChoice } = {}) {
  const body = buildChatBody(config, messages, { stream, tools, toolChoice });

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