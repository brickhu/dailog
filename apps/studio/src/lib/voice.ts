import { api } from "./client";

/** 上传录音样本并触发 Fish fast 音色训练（onboarding/settings 共用） */
export async function uploadVoiceSample(blob: Blob): Promise<{ referenceId: string }> {
  return api.post<{ referenceId: string }>("/api/me/voice-sample", blob);
}
