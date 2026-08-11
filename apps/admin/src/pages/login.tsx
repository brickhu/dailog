import { LoginForm } from "@dailogues/auth-ui";
import { useAuth } from "../lib/auth";

// 登录视图（守卫第一层锁定渲染）：cookie 会话模式——登录后浏览器保存 Domain cookie，
// applySession() 从 get-session 同步会话 → 自动解锁回原路径（site/admin 共享 SSO）
export default function LoginPage() {
  const auth = useAuth();
  const onSuccess = () => {
    void auth.applySession();
  };

  return (
    <LoginForm
      config={{
        loginOrOtpEndpoint: "/v1/auth/login-or-otp",
        otpCompleteEndpoint: "/v1/auth/otp-complete",
      }}
      onSuccess={onSuccess}
      redirect={{ enabled: false }}
    />
  );
}
