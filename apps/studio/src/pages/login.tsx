import { LoginForm, type LoginSuccess } from "@dailogues/auth-ui";
import { env } from "../lib/env";
import { useAuth } from "../lib/auth";
import { persistToken } from "../lib/auth-api";

// 登录锁定视图（AppShell 第一层守卫原地渲染；非独立路由——URL 保持不变，
// 登录成功后 auth 状态同步，锁定自动解锁回到原始路径）。
export default function LoginPage() {
  const auth = useAuth();
  const onSuccess = (r: LoginSuccess) => {
    if (r.token) persistToken(r.token);
    // LoginForm 已调 sign-in API：这里落 auth 状态 → 第一层解锁（URL 不变）
    // （LoginSuccess.user 字段可空，映射到 AuthUser 全量字段）
    auth.applySession(
      r.user
        ? { id: r.user.id, email: r.user.email, name: r.user.name ?? "", emailVerified: Boolean(r.user.emailVerified) }
        : null,
      r.token ?? null,
    );
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
      // 锁定模式：成功后不跳转（URL 不变），由 auth.user 状态切换解锁
      redirect={{ enabled: false }}
    />
  );
}
