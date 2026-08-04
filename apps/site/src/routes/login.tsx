import * as stylex from "@stylexjs/stylex";
import { Card } from "@dailogues/ui";
import { tokens } from "@dailogues/ui/theme.stylex";
import { LoginForm, type LoginInput } from "@dailogues/auth-ui";
import { env } from "../lib/env";

// 全站统一登录页（dailogues.com/login）：薄包装——UI/校验由共享 LoginForm 承担，
// 提交逻辑（POST 站内代理 + set-cookie SSO + 302 回 redirect）在本页注入。
const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: tokens.space4,
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

/** redirect 白名单：仅允许本站/studio 域（防开放重定向）；默认回首页 */
function sanitizeRedirect(raw: string | null): string {
  if (!raw) return "/";
  try {
    const u = new URL(raw, env.siteBaseUrl);
    const allowed = [env.siteBaseUrl, env.studioBaseUrl];
    if (allowed.some((base) => u.origin === new URL(base).origin)) return u.pathname + u.search;
  } catch {
    /* 非法 URL 回默认 */
  }
  return "/";
}

export default function LoginPage() {
  const redirect = () =>
    typeof window !== "undefined" ? sanitizeRedirect(new URLSearchParams(window.location.search).get("redirect")) : "/";

  const submit = async ({ mode, email, password, name }: LoginInput): Promise<string | null> => {
    // POST 对齐 better-auth 端点（/sign-in/email）：站内代理路由 sign-in/email.ts 同路径
    const res = await fetch(mode === "signin" ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "signin"
          ? { email, password }
          : { email, password, name: name || email.split("@")[0] },
      ),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      return data?.message ?? `登录失败（${res.status}）`;
    }
    // 成功：cookie 已由 server 代理设置 → 回跳
    window.location.href = redirect();
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
