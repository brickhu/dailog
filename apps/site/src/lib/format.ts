// 时间/日期格式化共用函数（全站统一；此前 fmtDuration 在 11 个文件重复定义）
// 用法：fmtDuration(1925) → "32:05"；fmtDuration(1925, true) → "32 分 05 秒"

/** 秒 → 时长文本。
 *  默认紧凑格式 "32:05"（列表/卡片/播放按钮通用）；
 *  verbose=true 输出播客感中文 "32 分 05 秒"（详情页等场景）。 */
export function fmtDuration(sec: number | null | undefined, verbose = false): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ss = String(s).padStart(2, "0");
  return verbose ? `${m} 分 ${ss} 秒` : `${m}:${ss}`;
}

/** 日期 → 本地日期字符串（默认 zh-CN，如 "2026/8/24"）；兼容 Date 与 ISO 字符串，空值返回空串 */
export function fmtDate(d: Date | string | null | undefined, locale = "zh-CN"): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString(locale);
}
