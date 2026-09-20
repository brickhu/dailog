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

// 展示时区：SSR 容器是 UTC、浏览器是用户本地时区 —— 日期/时间必须**固定时区**渲染，
// 否则同一页面服务端与客户端算出的文本不同（跨零点会差一天、带时间必差几小时），
// 直接触发 hydration mismatch。产品主受众在中文区，统一按北京时间展示。
// 需要换展示时区只改这一处（RSS feed 仍按标准输出 UTC，不受影响）。
export const DISPLAY_TIME_ZONE = "Asia/Shanghai";

/** 日期 → 展示日期字符串（默认 zh-CN，如 "2026/8/24"）；兼容 Date 与 ISO 字符串，空值返回空串 */
export function fmtDate(d: Date | string | null | undefined, locale = "zh-CN"): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString(locale, { timeZone: DISPLAY_TIME_ZONE });
}

/** 日期 + 时间 → 展示字符串（详情页「发布时间」等）。
 *  zh → "2026/9/16 23:32"；en → "9/16/2026, 11:32 PM"（时区固定，见 DISPLAY_TIME_ZONE） */
export function fmtDateTime(d: Date | string | null | undefined, locale = "zh-CN"): string {
  if (!d) return "";
  return new Date(d).toLocaleString(locale, {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
