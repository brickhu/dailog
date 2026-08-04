import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Card, TextField } from "@dailogues/ui";
import { tokens } from "@dailogues/ui/theme.stylex";
import { getLoginRedirect, type LoginRedirectOptions } from "./login-redirect";

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

/** 支持的登录方式（业务配置：未来扩展 github/wechat 时在此声明） */
export type LoginMethod = "email";

export interface LoginFormConfig {
  /** 登录 POST 端点（业务配置：site 传站内代理路径；studio 传 API 绝对地址） */
  signInEndpoint: string;
  /** 注册 POST 端点 */
  signUpEndpoint: string;
  /** 支持的登录方式（默认仅 email） */
  methods?: LoginMethod[];
}

export interface LoginSuccess {
  mode: LoginMode;
  user?: { id: string; email: string; name?: string } | null;
  token?: string | null;
}

export interface LoginFormProps {
  /** 业务配置：认证端点 + 登录方式（由宿主声明） */
  config: LoginFormConfig;
  /** 成功事件（可选）：会话就绪后触发，宿主可做额外落地（如持久化 token） */
  onSuccess?: (result: LoginSuccess) => void;
  /** 共享跳转："从哪里来就返回哪里去"（默认启用；白名单/回退由业务配置） */
  redirect?: LoginRedirectOptions & { enabled?: boolean };
}

/** 跨站统一登录页：完整页面（品牌 + Card + 表单）。配置驱动——业务侧只声明
 *  接口/登录方式/跳转白名单；内部统一流程：POST → 校验 → 成功事件 → 回来源。 */
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
      const isSignin = mode() === "signin";
      const res = await fetch(isSignin ? props.config.signInEndpoint : props.config.signUpEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignin
            ? { email: email().trim(), password: password() }
            : { email: email().trim(), password: password(), name: name().trim() || email().trim().split("@")[0] },
        ),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(data?.message ?? `登录失败（${res.status}）`);
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { user?: LoginSuccess["user"]; token?: string | null }
        | null;
      props.onSuccess?.({ mode: mode(), user: body?.user ?? null, token: body?.token ?? null });
      // 共享跳转：从哪里来就返回哪里去
      if (props.redirect?.enabled !== false) {
        window.location.href = getLoginRedirect(props.redirect);
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <Card>
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
      </Card>
    </div>
  );
}
