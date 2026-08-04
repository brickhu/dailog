import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { LoginForm, type LoginSuccess } from "@dailogues/auth-ui";
import { env } from "../lib/env";
import { useAuth } from "../lib/auth";
import { persistToken } from "../lib/auth-api";
import { injectExtensionToken } from "../lib/ext-inject";

// studio 备用登录页（app.dailogues.com/login 兜底）：业务配置声明——认证端点（API 直连）+ 成功事件
// （持久化 token + 扩展注入）。页面与流程由共享 LoginForm 提供。
export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  // 已登录访问登录页 → 直接进工作台
  createEffect(() => {
    if (!auth.loading && auth.user) navigate("/episodes", { replace: true });
  });

  const onSuccess = (r: LoginSuccess) => {
    if (r.token) persistToken(r.token);
    void injectExtensionToken();
  };

  return (
    <LoginForm
      config={{
        signInEndpoint: `${env.apiBaseUrl}/api/auth/sign-in/email`,
        signUpEndpoint: `${env.apiBaseUrl}/api/auth/sign-up/email`,
        verification: {
          resendEndpoint: `${env.apiBaseUrl}/api/auth/send-verification-email`,
          // 验证链接点击后跳回当前站点
          callbackURL: window.location.origin,
        },
      }}
      onSuccess={onSuccess}
    />
  );
}
