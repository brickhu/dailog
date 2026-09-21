// 声音采样的业务侧封装（上传）：录音弹窗只负责录音，上传等业务逻辑由使用方调用本模块。
// 端点：POST /v1/me/voice-sample（multipart：file + transcript + language + duration + callName?）
// 另：PATCH /v1/me/voice-sample { language, callName } —— 只改该语种采样行上的「节目称呼」
export interface UploadVoiceSampleInput {
  /** 录音音频（录音弹窗 onSubmit 回调交回的 blob） */
  blob: Blob;
  /** 采样语种（ISO 639-1；与投稿区一致） */
  language: string;
  /** 朗读文案（零样本克隆的参考文本） */
  transcript: string;
  /** 录音时长（秒） */
  duration: number;
  /** 该语种节目中的称呼（callName，存在采样行上；缺省不改动已有值） */
  callName?: string | null;
}

/** 上传声音采样：成功返回 sampleId（可能为 null），失败返回 null（调用方提示重试） */
export async function uploadVoiceSample(input: UploadVoiceSampleInput): Promise<{ sampleId: string | null } | null> {
  const form = new FormData();
  form.append("file", input.blob, "voice.webm");
  form.append("transcript", input.transcript ?? "");
  form.append("language", input.language);
  form.append("duration", String(input.duration));
  if (input.callName != null) form.append("callName", input.callName);
  try {
    const res = await fetch("/v1/me/voice-sample", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { sampleId?: string } | null;
    return { sampleId: data?.sampleId ?? null };
  } catch {
    return null;
  }
}

/** 只保存「节目称呼」（写在采样行上；该语种还没录音时服务端会建 draft 行） */
export async function saveVoiceSampleCallName(language: string, callName: string): Promise<boolean> {
  try {
    const res = await fetch("/v1/me/voice-sample", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language, callName }),
    });
    // 必须校验 JSON：缺代理方法时 SPA fallback 会返回 200 + HTML，只判 res.ok 会误判成功
    return res.ok && (res.headers.get("content-type") ?? "").includes("application/json");
  } catch {
    return false;
  }
}
