// 脚本文本工具：情绪标签是平台 TTS（Fish S2）专用指令——对外只暴露去标签纯文本，
// 防止脚本被搬运到其他语音模型（无情绪标签 = 白开水台词，平台生成是唯一"直接出成品"路径）。
// 标签格式：[happy] [very excited] [break] [long-break] [slightly sad] 等（字母/空格/连字符）

const EMOTION_TAG = /\[[a-zA-Z][a-zA-Z -]*\]/g;

/** 去情绪标签（含停顿/音效标记）→ 纯文本 */
export function stripEmotionTags(text: string): string {
  return text.replace(EMOTION_TAG, "").replace(/\s+/g, " ").trim();
}

/** 段落数组去标签（speaker 保留） */
export function stripSegmentTexts<T extends { text: string }>(segments: T[]): T[] {
  return segments.map((s) => ({ ...s, text: stripEmotionTags(s.text) }));
}

/** 字幕文本（段落去标签后按行拼接） */
export function segmentsToSubtitle(segments: { text: string }[]): string {
  return stripSegmentTexts(segments)
    .map((s) => s.text)
    .filter(Boolean)
    .join("\n");
}
