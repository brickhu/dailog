// 跨站认证业务组件：配置驱动（端点/登录方式由宿主声明）+ 共享流程（POST → 成功事件 → 回来源）
export { LoginForm, type LoginFormProps, type LoginFormConfig, type LoginSuccess, type LoginMode, type LoginMethod } from "./login-form";
export { getLoginRedirect, type LoginRedirectOptions } from "./login-redirect";
