// 采样语种支持列表——录音语种与界面语言解耦：
//  - code = ISO 639-1（后端 voice_samples.language 校验 /^[a-z]{2,3}$/，一人一语种一条）
//  - 语种显示名走 i18n（lang.<code>，zh/en 词典各一份）
//  - 朗读文案见 lib/reading-scripts.ts（主流语言内置翻译，未覆盖语种回退英文）
//  - 当前站点仅中文/英文界面，录音语种先只开放 zh/en（ENABLED_SAMPLE_LANGUAGES）；
//    后续开放更多语种时，把 code 从 SAMPLE_LANGUAGES 移入 ENABLED 即可（能力已保留）

/** 当前开放的采样语种（选择器展示；先只开放中文与英文） */
export const ENABLED_SAMPLE_LANGUAGES: string[] = ["zh", "en"];

/** 全量支持语种（保留能力：内置文案/词典均已就绪，仅未开放） */
export const SAMPLE_LANGUAGES: string[] = [
  "zh", "en", "ja", "ko", "fr", "de", "es", "ru", "pt", "it",
  "ar", "hi", "th", "vi", "id", "ms", "tr", "nl", "pl", "uk",
  "sv", "no", "da", "fi", "cs", "sk", "el", "he", "hu", "ro",
  "bg", "fa", "bn", "ta", "sw",
];

/** code 是否在开放列表内（弹窗默认语种解析；未开放/未知码回退界面语言） */
export function isSupportedSampleLanguage(code: string | null | undefined): boolean {
  return ENABLED_SAMPLE_LANGUAGES.includes(code ?? "");
}
