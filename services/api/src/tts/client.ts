import { msgpackEncode } from "./msgpack";

export interface TtsSegment { speaker: number; text: string; }

export interface TtsClient {
  /** 多说话人一次调用（零样本内联：每 speaker 一段参考音频，references 2D，已实测 200——fish-references2d.mjs） */
  synthesizeMultiSpeaker(args: {
    segments: TtsSegment[];
    referenceAudios: Uint8Array[]; // 下标对应 speaker 序号
    /** 每 speaker 参考音频转录文本（精确克隆；缺省占位） */
    transcripts?: (string | null)[];
  }): Promise<Uint8Array>;
  /** 按段合成（降级路径：主持人内联参考音频 msgpack 零样本；或固定音色模型 id referenceId） */
  synthesizeSingle(args: {
    text: string;
    referenceAudio?: Uint8Array; // msgpack references 内联
    /** 参考音频转录文本（精确克隆；缺省用合成文本占位） */
    referenceAudioTranscript?: string;
    referenceId?: string;
  }): Promise<Uint8Array>;
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
    referenceAudios: Uint8Array[];
    /** 每 speaker 参考音频转录文本（精确克隆；缺省占位） */
    transcripts?: (string | null)[];
  }): Promise<Uint8Array> {
    const text = args.segments
      .map((s) => `<|speaker:${s.speaker}|>${s.text}`)
      .join("");
    // references 2D：[[speaker0 样本], [speaker1 样本], ...]——零样本多说话人（已实测 200，
    // fish-references2d.mjs）。转录文本精确（用户朗读固定文案），缺省占位（ASR 402，见 fish-audio.md §6）。
    const body = msgpackEncode({
      text,
      references: args.referenceAudios.map((audio, i) => [
        { audio, text: args.transcripts?.[i] ?? REF_TRANSCRIPT },
      ]),
      format: "mp3",
      mp3_bitrate: 128,
    });
    const res = await requestWithFallback(`${base}/v1/tts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/msgpack" },
      body,
    });
    if (!res.ok) throw new Error(`tts http_${res.status}: ${(await res.text()).slice(0, 200)}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function synthesizeSingle(args: {
    text: string;
    referenceAudio?: Uint8Array;
    /** 参考音频转录文本（精确克隆；缺省用合成文本占位） */
    referenceAudioTranscript?: string;
    referenceId?: string;
  }): Promise<Uint8Array> {
    if (args.referenceAudio !== undefined && args.referenceId !== undefined) {
      // 二选一校验：referenceAudio 走 msgpack 内联、referenceId 走 JSON，静默丢弃会得到错误音色
      throw new Error("tts: referenceAudio 与 referenceId 只能二选一");
    }
    const body = args.referenceAudio
      ? // 零样本内联：msgpack references（JSON 无 base64 字段，实测见 fish-audio.md）
        buildMsgpackReferences(args.referenceAudio, args.text, args.referenceAudioTranscript)
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

  return { synthesizeMultiSpeaker, synthesizeSingle };
}

/** 参考音频转录占位文本（ASR 402 无法自动转录，见 fish-audio.md §6；转录准确度影响克隆质量） */
const REF_TRANSCRIPT =
  "你好，欢迎收听 dailog。这是参考音频的转录文本，用于声音克隆测试。";

/**
 * msgpack 最小编码：{ text, references: [{ audio, text }], format: "mp3" }。
 * 结构与 docs/spikes/fish-audio.md §3-a / scripts/spikes/fish-audio.mjs 实测一致：
 * ReferenceAudio = { audio: 原始 WAV 字节（bin）, text: 参考音频转录 }（两者必填），
 * 服务器对 msgpack 严格校验（fish-audio.md §9-3）。
 * transcript 优先用真实转录（用户朗读固定文案）；缺省以合成文本占位（转录准确度影响克隆质量，§6）。
 */
function buildMsgpackReferences(audio: Uint8Array, text: string, transcript?: string): Uint8Array<ArrayBuffer> {
  return msgpackEncode({
    text,
    references: [{ audio, text: transcript ?? text }],
    format: "mp3",
  });
}
