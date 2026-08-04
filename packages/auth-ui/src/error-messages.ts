/** 认证失败响应体（better-auth 错误：message + code） */
export interface AuthErrorBody {
  message?: string;
  code?: string;
}

/** better-auth 错误码 → 中文文案（共享失败体验；未收录的 code 回退原文 message） */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "该邮箱已注册，请直接登录",
  PASSWORD_TOO_SHORT: "密码太短（至少 8 位）",
  VALIDATION_ERROR: "输入有误，请检查邮箱和密码格式",
  INVALID_ORIGIN: "请求来源不被信任，请刷新后重试",
  UNAUTHORIZED: "登录状态已失效，请重新登录",
};

/** 认证错误 → 用户可读文案：优先错误码映射，其次 API message，最后 HTTP 状态兜底 */
export function getLoginErrorMessage(body: AuthErrorBody | null, status: number): string {
  if (body?.code && ERROR_MESSAGES[body.code]) return ERROR_MESSAGES[body.code];
  if (body?.message) return body.message;
  return `操作失败（${status}）`;
}
