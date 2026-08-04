import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { LoginForm, type LoginInput } from "@dailogues/auth-ui";
import { useAuth } from "../lib/auth";

// studio 备用登录页（app.dailogues.com/login 兜底）：纯逻辑包装——完整页面由共享
// LoginForm 渲染，本页只注入提交逻辑（AuthProvider signIn/signUp + 跳转）。
export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  // 已登录访问登录页 → 直接进工作台
  createEffect(() => {
    if (!auth.loading && auth.user) navigate("/episodes", { replace: true });
  });

  const submit = async ({ mode, email, password, name }: LoginInput): Promise<string | null> => {
    if (mode === "signin") {
      const { error } = await auth.signIn(email, password);
      if (error) return error;
      navigate("/episodes");
    } else {
      const { error } = await auth.signUp(email, password, name || email.split("@")[0] || "用户");
      if (error) return error;
      // 注册成功即登录态：先开通频道（授权码），再录声音
      navigate("/onboarding");
    }
    return null;
  };

  return <LoginForm onSubmit={submit} />;
}
