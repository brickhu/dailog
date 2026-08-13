// 跨站认证业务组件：配置驱动（端点/登录方式由宿主声明）+ 共享流程（POST → 成功/失败处理 → 回来源）
export { LoginForm, type LoginFormProps, type LoginFormConfig, type LoginSuccess, type LoginMode } from "./login-form";
export { getLoginRedirect, type LoginRedirectOptions } from "./login-redirect";
export { getLoginErrorMessage, type AuthErrorBody } from "./error-messages";
