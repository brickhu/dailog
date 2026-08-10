import { createContext, createSignal, useContext, type ParentProps } from "solid-js";
import { dictionaries, detectLocale, setLocaleCookie, resolveLocale, type Locale } from "./locale";

export type { Locale };
export { detectLocale, resolveLocale };
export type TKey = keyof typeof dictionaries["zh"];

export interface I18nContextValue {
  /** 当前语言 */
  locale: () => Locale;
  /** 切换语言（持久化 cookie + 更新 <html lang>） */
  setLocale: (locale: Locale) => void;
  /** 翻译：key → 当前语言 → en（fallback）→ key */
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>();

export interface I18nProviderProps extends ParentProps {
  /** SSR 注入的初始语言（entry-server 解析 accept-language/cookie 传入）；缺省自动检测 */
  initialLocale?: Locale;
}

/** 全局语言上下文：所有组件经 useI18n() 取 t/locale/setLocale */
export function I18nProvider(props: I18nProviderProps) {
  const [locale, setLocaleSignal] = createSignal<Locale>(props.initialLocale ?? detectLocale());

  const value: I18nContextValue = {
    locale,
    setLocale: (next) => {
      setLocaleSignal(next);
      setLocaleCookie(next);
      if (typeof document !== "undefined") {
        document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
      }
    },
    t: (key, vars) => {
      const dict = dictionaries[locale()] ?? dictionaries.en;
      const fallback = dictionaries.en;
      let text = dict[key] ?? fallback[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
  };

  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>;
}

/** 取翻译上下文：无 Provider 时降级为自动检测语言的只读实现（组件库场景安全） */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const fallbackLocale = detectLocale();
  return {
    locale: () => fallbackLocale,
    setLocale: (next) => {
      setLocaleCookie(next);
      if (typeof document !== "undefined") document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    },
    t: (key, vars) => {
      const dict = dictionaries[fallbackLocale] ?? dictionaries.en;
      let text = dict[key] ?? dictionaries.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`{${k}}`, String(v));
        }
      }
      return text;
    },
  };
}

/** 简单挂载助手：应用根只需包一层（SSR 可传 initialLocale） */
export default I18nProvider;
