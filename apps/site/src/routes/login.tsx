import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@dailogues/ui/theme.stylex";
import { env } from "../lib/env";

// 全站统一登录页（dailogues.com/login）：
// 表单 POST 站内 /api/auth/sign-in|sign-up（server 代理 api + set-cookie SSO）→ 302 回 redirect
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
  card: {
    width: "100%",
    maxWidth: "400px",
    padding: tokens.space6,
    borderRadius: tokens.radiusLg,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
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
  tabs: {
    display: "flex",
    gap: tokens.space2,
    marginBottom: tokens.space5,
  },
  tab: {
    flex: 1,
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorBorder}`,
    background: "transparent",
    color: tokens.colorTextMuted,
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  tabActive: {
    background: tokens.colorPrimary,
    borderColor: tokens.colorPrimary,
    color: "#fff",
  },
  field: {
    marginBottom: tokens.space4,
  },
  label: {
    display: "block",
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space1,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorBg,
    color: tokens.colorText,
    fontSize: tokens.fontSizeMd,
  },
  submit: {
    width: "100%",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    fontSize: tokens.fontSizeMd,
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    marginTop: tokens.space2,
  },
  error: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
  },
});

/** redirect 白名单：仅允许本站/studio 域（防开放重定向）；默认回首页 */
function sanitizeRedirect(raw: string | null): string {
  if (!raw) return "/";
  try {
    const u = new URL(raw, env.siteBaseUrl);
    const allowed = [env.siteBaseUrl, env.studioBaseUrl];
    if (allowed.some((base) => u.origin === new URL(base).origin)) return u.pathname + u.search;
  } catch { /* 非法 URL 回默认 */ }
  return "/";
}

export default function LoginPage() {
  const [mode, setMode] = createSignal<"signin" | "signup">("signin");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const redirect = () =>
    typeof window !== "undefined" ? sanitizeRedirect(new URLSearchParams(window.location.search).get("redirect")) : "/";

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (password().length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode() === "signin" ? "/api/auth/sign-in" : "/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode() === "signin"
            ? { email: email().trim(), password: password() }
            : { email: email().trim(), password: password(), name: name().trim() || email().trim().split("@")[0] },
        ),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? `登录失败（${res.status}）`);
        return;
      }
      // 成功：cookie 已由 server 代理设置 → 302 回跳
      window.location.href = redirect();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.brand)}>dailogues</div>
        <div {...stylex.props(styles.tagline)}>把你的 AI 对话，变成你的播客</div>
        <div {...stylex.props(styles.tabs)}>
          <button
            {...stylex.props(styles.tab, mode() === "signin" && styles.tabActive)}
            onClick={() => setMode("signin")}
          >
            登录
          </button>
          <button
            {...stylex.props(styles.tab, mode() === "signup" && styles.tabActive)}
            onClick={() => setMode("signup")}
          >
            注册
          </button>
        </div>
        <form onSubmit={submit}>
          <Show when={mode() === "signup"}>
            <div {...stylex.props(styles.field)}>
              <label {...stylex.props(styles.label)}>昵称（可选）</label>
              <input
                {...stylex.props(styles.input)}
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                autocomplete="nickname"
              />
            </div>
          </Show>
          <div {...stylex.props(styles.field)}>
            <label {...stylex.props(styles.label)}>邮箱</label>
            <input
              {...stylex.props(styles.input)}
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              autocomplete="email"
            />
          </div>
          <div {...stylex.props(styles.field)}>
            <label {...stylex.props(styles.label)}>密码</label>
            <input
              {...stylex.props(styles.input)}
              type="password"
              required
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete={mode() === "signup" ? "new-password" : "current-password"}
            />
          </div>
          <button type="submit" {...stylex.props(styles.submit)} disabled={busy()}>
            {busy() ? "提交中…" : mode() === "signin" ? "登录" : "注册"}
          </button>
          <Show when={error()}>
            <div {...stylex.props(styles.error)}>{error()}</div>
          </Show>
        </form>
      </div>
    </div>
  );
}
