import { createEffect } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Card } from "@dailogues/ui";
import { tokens } from "@dailogues/ui/theme.stylex";
import { LoginForm, type LoginInput } from "@dailogues/auth-ui";
import { useAuth } from "../lib/auth";

// studio 备用登录页（app.dailogues.com/login 兜底）：薄包装——UI/校验由共享 LoginForm 承担，
// 提交逻辑（AuthProvider signIn/signUp + 跳转）在本页注入。
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorBg,
    padding: tokens.space4,
    minWidth: "320px",
  },
  brand: {
    fontSize: "28px",
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorPrimary,
    marginBottom: tokens.space1,
  },
  tagline: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space5,
  },
});

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

  return (
    <div {...stylex.props(styles.page)}>
      <Card>
        <div {...stylex.props(styles.brand)}>dailogues</div>
        <div {...stylex.props(styles.tagline)}>把你的 AI 对话，变成你的播客</div>
        <LoginForm onSubmit={submit} />
      </Card>
    </div>
  );
}
