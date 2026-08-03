import { createEffect, createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { useAuth } from "../lib/auth";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorBg,
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
  info: {
    color: tokens.colorSuccess,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
  },
  hint: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space3,
    textAlign: "center",
  },
});

export default function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  // 已登录访问登录页 → 直接进工作台
  createEffect(() => {
    if (!auth.loading && auth.user) navigate("/episodes", { replace: true });
  });
  const [mode, setMode] = createSignal<"signin" | "signup">("signin");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [info, setInfo] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const switchMode = (m: "signin" | "signup") => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (password().length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setBusy(true);
    try {
      if (mode() === "signin") {
        const { error } = await auth.signIn(email().trim(), password());
        if (error) return setError(error);
        navigate("/episodes");
      } else {
        const name = email().trim().split("@")[0] || "用户";
        const { error } = await auth.signUp(email().trim(), password(), name);
        if (error) return setError(error);
        // 注册成功即登录态：先开通频道（授权码），再录声音
        navigate("/onboarding");
      }
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
            onClick={() => switchMode("signin")}
          >
            登录
          </button>
          <button
            {...stylex.props(styles.tab, mode() === "signup" && styles.tabActive)}
            onClick={() => switchMode("signup")}
          >
            注册
          </button>
        </div>
        <form onSubmit={submit}>
          <div {...stylex.props(styles.field)}>
            <label {...stylex.props(styles.label)}>邮箱</label>
            <input
              {...stylex.props(styles.input)}
              type="email"
              required
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              placeholder="you@example.com"
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
              placeholder="至少 8 位"
              autocomplete={mode() === "signup" ? "new-password" : "current-password"}
            />
          </div>
          <button type="submit" {...stylex.props(styles.submit)} disabled={busy()}>
            {busy() ? "提交中…" : mode() === "signin" ? "登录" : "注册"}
          </button>
        </form>
        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>
        <Show when={info()}>
          <div {...stylex.props(styles.info)}>{info()}</div>
        </Show>
        <div {...stylex.props(styles.hint)}>注册即登录 · 邀请码用于开通频道</div>
      </div>
    </div>
  );
}
