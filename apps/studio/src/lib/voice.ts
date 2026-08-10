import { api } from "./client";

/** 主持人朗读的固定文案（录音引导 + 转录文本，零样本克隆质量依赖它）——改文案时注意与产品一致 */
export const HOST_READING_SCRIPT =
  "大家好，我是 dailog 的主持人。欢迎收听我的播客，今天我想和你分享一个有趣的想法，关于如何把对话变成值得收藏的声音。让我们一起开始吧。";

/** 上传录音样本（onboarding/settings 共用）：只保存文件 + 转录文本，不训练音色模型。
 *  生成时由服务端以参考音频 + 转录文本方式直接使用样本（样本直传模式）。
 *  后端期望 multipart/form-data 的 file/transcript 字段——Blob 必须用 FormData 包装，
 *  直接当 body 发会被 JSON.stringify 序列化成 {}（400 file_required）。 */
export async function uploadVoiceSample(blob: Blob, transcript: string): Promise<{ ok: true }> {
  const form = new FormData();
  form.append("file", blob, "voice.webm");
  form.append("transcript", transcript);
  return api.post<{ ok: true }>("/v1/me/voice-sample", form);
}
