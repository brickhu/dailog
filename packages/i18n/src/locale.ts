// 语言检测与持久化：
//   优先级：cookie（dailog_locale，手动选择）→ 浏览器语言（navigator.language /
//   SSR accept-language）→ "en"（fallback）
// 支持多语言：新增语言 = dictionaries 加字典 + 此处 SUPPORTED 注册

import { zh, en, type Dictionary } from "./dictionaries";

export type Locale = keyof typeof dictionaries;
export const SUPPORTED_LOCALES = ["zh", "en"] as const;

export const dictionaries: Record<string, Dictionary> = { zh, en };

export const LOCALE_COOKIE = "dailog_locale";

/** 语言标签 → 支持的 locale（zh-CN → zh；其他 → en） */
export function resolveLocale(lang: string | undefined | null): Locale {
  if (lang && lang.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

/** 读 cookie（客户端） */
export function getLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  return m ? resolveLocale(m[1]) : null;
}

/** 写 cookie（手动切换持久化；跨子域共享，SSO 同域） */
export function setLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * 检测当前语言（两端通用）：
 *  - SSR：cookie 头 > accept-language 头
 *  - 客户端：cookie > navigator.language
 *  - 兜底 "en"
 */
export function detectLocale(opts?: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  // ① cookie（手动选择持久化；支持两种入参：值 "zh" 或完整 cookie 头 "dailog_locale=zh"——
  //    SSR 传 request 的 cookie 头，client 走 getLocaleCookie 已解析）
  let cookie =
    opts?.cookie ??
    (typeof document !== "undefined" ? getLocaleCookie() : null);
  if (cookie && cookie.includes("=")) {
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
    cookie = m ? m[1] : null;
  }
  if (cookie) return resolveLocale(cookie);
  // ② 浏览器/请求语言
  if (opts?.acceptLanguage) return resolveLocale(opts.acceptLanguage.split(",")[0]);
  if (typeof navigator !== "undefined" && navigator.language) {
    return resolveLocale(navigator.language);
  }
  // ③ fallback 英文
  return "en";
}
