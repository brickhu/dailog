import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, TextField } from "@dailogues/ui";
import { tokens } from "@dailogues/ui/theme.stylex";

const styles = stylex.create({
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
  nameField: {
    marginBottom: tokens.space4,
  },
  nameLabel: {
    display: "block",
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space1,
  },
  nameInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorBorder}`,
    background: tokens.colorBg,
    color: tokens.colorText,
    fontSize: tokens.fontSizeMd,
  },
  error: {
    color: tokens.colorDanger,
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

export type LoginMode = "signin" | "signup";

export interface LoginInput {
  mode: LoginMode;
  email: string;
  password: string;
  /** 注册时昵称（可选，空则取邮箱前缀） */
  name: string;
}

export interface LoginFormProps {
  /** 提交逻辑（各站注入：site 走站内代理 fetch；studio 走 AuthProvider signIn/signUp）。
   *  返回错误消息（null = 成功）；成功后由调用方自行处理跳转。 */
  onSubmit: (input: LoginInput) => Promise<string | null>;
}

/** 跨站共享登录/注册表单（UI + 校验 + 状态；提交逻辑由包装页注入，两站零耦合） */
export function LoginForm(props: LoginFormProps) {
  const [mode, setMode] = createSignal<LoginMode>("signin");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (password().length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const err = await props.onSubmit({
        mode: mode(),
        email: email().trim(),
        password: password(),
        name: name().trim(),
      });
      if (err) setError(err);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
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
          <div {...stylex.props(styles.nameField)}>
            <label {...stylex.props(styles.nameLabel)}>昵称（可选）</label>
            <input
              {...stylex.props(styles.nameInput)}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              autocomplete="nickname"
            />
          </div>
        </Show>
        <TextField
          label="邮箱"
          type="email"
          value={email()}
          onInput={setEmail}
          placeholder="you@example.com"
          autocomplete="email"
        />
        <TextField
          label="密码"
          type="password"
          value={password()}
          onInput={setPassword}
          placeholder="至少 8 位"
          autocomplete={mode() === "signup" ? "new-password" : "current-password"}
        />
        <Button type="submit" block disabled={busy()}>
          {busy() ? "提交中…" : mode() === "signin" ? "登录" : "注册"}
        </Button>
        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>
        <div {...stylex.props(styles.hint)}>注册即登录 · 邀请码用于开通频道</div>
      </form>
    </>
  );
}

