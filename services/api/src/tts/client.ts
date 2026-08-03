import { msgpackEncode } from "./msgpack";

export interface TtsSegment { speaker: number; text: string; }

export interface TtsClient {
  /** 多说话人一次调用（全 reference_id 模型 id） */
  synthesizeMultiSpeaker(args: {
    segments: TtsSegment[];
    referenceIds: string[]; // 下标对应 speaker 序号
  }): Promise<Uint8Array>;
  /** 按段零样本（主持人内联参考音频 msgpack）/ 固定音色 */
  synthesizeSingle(args: {
    text: string;
    referenceAudio?: Uint8Array; // msgpack references 内联
    referenceId?: string;
  }): Promise<Uint8Array>;
  /** 创建/训练音色模型（POST /model fast 训练 5-8s，免费，0 额度也可用）→ { id }（响应 _id） */
  createVoiceModel(args: { audio: Uint8Array; name: string }): Promise<{ id: string }>;
}

export interface TtsOptions {
  apiKey: string;
  proxyUrl?: string; // socks5://host:port，本地代理
  fetchImpl?: typeof fetch;
  /** 默认免费模型；Fish 免费模型 s2.1-pro-free $0/M（spike 校准，见 docs/spikes/fish-audio.md） */
  model?: string;
  /** 免费模型余额不足（402）时自动切换的付费模型 */
  fallbackModel?: string;
}

export function createTtsClient(opts: TtsOptions): TtsClient {
  const f = opts.fetchImpl ?? fetch;
  const base = "https://api.fish.audio";
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` };
  const model = opts.model ?? "s2.1-pro-free";
  const fallbackModel = opts.fallbackModel ?? "s2.1-pro";

  // 402 余额不足 → 自动降级付费模型重试（免费额度用完后不中断用户生成）
  async function requestWithFallback(url: string, init: RequestInit): Promise<Response> {
    const res = await f(url, init);
    if (res.status !== 402) return res;
    const body = await res.text().catch(() => "");
    const retry = await f(url, {
      ...init,
      body: replaceModelField(init.body, fallbackModel),
    });
    if (!retry.ok) throw new Error(`tts http_${retry.status}: ${body.slice(0, 200)}`);
    return retry;
  }

  /** JSON body 内替换 model 字段（msgpack 无 model 字段，仅 JSON 场景降级） */
  function replaceModelField(body: BodyInit | null | undefined, newModel: string): BodyInit | null | undefined {
    if (typeof body !== "string") return body;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (typeof parsed.model !== "string") return body;
      return JSON.stringify({ ...parsed, model: newModel });
    } catch {
      return body;
    }
  }

  // NOTE: 代理场景（本地 socks5）由调用方注入已包装的 fetchImpl；
  //       服务端生产环境直连无需代理。见 Task 9 的 fetchWithProxy 说明。

  async function synthesizeMultiSpeaker(args: {
    segments: TtsSegment[];
    referenceIds: string[];
  }): Promise<Uint8Array> {
    const text = args.segments
      .map((s) => `<|speaker:${s.speaker}|>${s.text}`)
      .join("");
    const res = await requestWithFallback(`${base}/v1/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, text, reference_id: args.referenceIds, format: "mp3" }),
    });
    if (!res.ok) throw new Error(`tts http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function synthesizeSingle(args: {
    text: string;
    referenceAudio?: Uint8Array;
    referenceId?: string;
  }): Promise<Uint8Array> {
    if (args.referenceAudio !== undefined && args.referenceId !== undefined) {
      // 二选一校验：referenceAudio 走 msgpack 内联、referenceId 走 JSON，静默丢弃会得到错误音色
      throw new Error("tts: referenceAudio 与 referenceId 只能二选一");
    }
    const body = args.referenceAudio
      ? // 零样本内联：msgpack references（JSON 无 base64 字段，实测见 fish-audio.md）
        buildMsgpackReferences(args.referenceAudio, args.text)
      : JSON.stringify({ model, text: args.text, reference_id: args.referenceId, format: "mp3" });
    const res = await requestWithFallback(`${base}/v1/tts`, {
      method: "POST",
      headers: args.referenceAudio
        ? { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/msgpack" }
        : headers,
      body,
    });
    if (!res.ok) throw new Error(`tts http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function createVoiceModel(args: { audio: Uint8Array; name: string }): Promise<{ id: string }> {
    // 校准自 scripts/spikes/fish-audio.mjs createHostModel / docs/spikes/fish-audio.md §3-b：
    // 表单字段 type=tts、train_mode=fast、title、visibility=private、tags=zh、
    // voices=@file（文件字段名是 voices 不是 file）；成功 201 → { _id, state }，id 取 _id
    const form = new FormData();
    form.append("type", "tts");
    form.append("train_mode", "fast");
    form.append("title", args.name);
    form.append("visibility", "private");
    form.append("tags", "zh");
    form.append("voices", new Blob([args.audio as Uint8Array<ArrayBuffer>]), "voice.wav");
    const res = await f(`${base}/model`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`voice model http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { _id: string };
    return { id: data._id };
  }

  return { synthesizeMultiSpeaker, synthesizeSingle, createVoiceModel };
}

/**
 * msgpack 最小编码：{ text, references: [{ audio, text }], format: "mp3" }。
 * 结构与 docs/spikes/fish-audio.md §3-a / scripts/spikes/fish-audio.mjs 实测一致：
 * ReferenceAudio = { audio: 原始 WAV 字节（bin）, text: 参考音频转录 }（两者必填），
 * 服务器对 msgpack 严格校验（fish-audio.md §9-3）。
 *
 * 诚实说明：参考音频转录文本（references[].text）不在本接口暴露，暂以合成文本
 * 占位——与 spike 同样做法（ASR 付费且 0 额度 402，见 fish-audio.md §6：转录准确度
 * 影响克隆质量）。Task 7/9 如需高质量克隆，应给 synthesizeSingle 增加 transcript 参数。
 */
function buildMsgpackReferences(audio: Uint8Array, text: string): Uint8Array<ArrayBuffer> {
  return msgpackEncode({
    text,
    references: [{ audio, text }],
    format: "mp3",
  });
}
