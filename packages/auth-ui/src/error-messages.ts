import type { I18nContextValue, TKey } from "@dailogues/i18n";

/** 认证失败响应体（better-auth 错误：message + code） */
export interface AuthErrorBody {
  message?: string;
  code?: string;
}

/** better-auth 错误码 → 文案 key（共享失败体验；未收录的 code 回退原文 message） */
const ERROR_CODE_KEYS: Record<string, TKey> = {
  INVALID_EMAIL_OR_PASSWORD: "auth.error.invalidCredentials",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "auth.error.emailTaken",
  PASSWORD_TOO_SHORT: "auth.error.passwordTooShort",
  VALIDATION_ERROR: "auth.error.validation",
  INVALID_ORIGIN: "auth.error.invalidOrigin",
  UNAUTHORIZED: "auth.error.unauthorized",
};

/** 认证错误 → 用户可读文案：优先错误码映射，其次 API message，最后 HTTP 状态兜底 */
export function getLoginErrorMessage(t: I18nContextValue["t"], body: AuthErrorBody | null, status: number): string {
  const key = body?.code ? ERROR_CODE_KEYS[body.code] : undefined;
  if (key) return t(key);
  if (body?.message) return body.message;
  return t("auth.error.http", { status: String(status) });
}
