import { LoginForm } from "@dailogues/auth-ui";
import { env } from "../lib/env";

// 全站统一登录页（dailogues.com/login）：业务配置声明——认证端点（站内代理）+ 跳转白名单。
// 页面与流程全部由共享 LoginForm 提供。
export default function LoginPage() {
  return (
    <LoginForm
      config={{
        signInEndpoint: "/api/auth/sign-in/email",
        signUpEndpoint: "/api/auth/sign-up/email",
      }}
      redirect={{ allowedOrigins: [env.siteBaseUrl, env.studioBaseUrl] }}
    />
  );
}
