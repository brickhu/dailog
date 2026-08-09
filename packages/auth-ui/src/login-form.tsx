import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Card, TextField } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { getLoginRedirect, type LoginRedirectOptions } from "./login-redirect";
import { getLoginErrorMessage } from "./error-messages";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: dimensions.spacing4,
  },
  brand: {
    fontSize: "28px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.primary,
    marginBottom: dimensions.spacing1,
  },
  tagline: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing6,
  },
  tabs: {
    display: "flex",
    gap: dimensions.spacing2,
    marginBottom: dimensions.spacing6,
  },
  tab: {
    flex: 1,
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: "transparent",
    color: colors.neutral,
    cursor: "pointer",
    fontSize: dimensions.fontSizeMd,
  },
  tabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    color: colors.onPrimary,
  },
  nameField: {
    marginBottom: dimensions.spacing4,
  },
  nameLabel: {
    display: "block",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing1,
  },
  nameInput: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
  hint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing3,
    textAlign: "center",
  },
  noticePanel: {
    textAlign: "center",
    padding: `${dimensions.spacing4} 0`,
  },
  noticeTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    color: colors.foreground,
    marginBottom: dimensions.spacing2,
  },
  noticeText: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    lineHeight: "1.6",
    marginBottom: dimensions.spacing4,
    wordBreak: "break-all",
  },
  noticeButtons: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  noticeMsg: {
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
  noticeMsgOk: {
    color: colors.primary,
  },
});

/** 统一登录/注册模式：老用户密码登录，新用户验证码注册（同一表单） */
export type LoginMode = "signin" | "signup";

/** 支持的登录方式（业务配置：未来扩展 github/wechat 时在此声明） */
export type LoginMethod = "email";

export interface LoginFormConfig {
  /** 统一提交端点：老用户密码登录 / 新用户发验证码（POST { email, password, name? } → { token, user } | { needOtp: true }） */
  loginOrOtpEndpoint: string;
  /** 新用户验证码完成注册（POST { email, otp, password, name? } → { token, user }） */
  otpCompleteEndpoint: string;
  /** 支持的登录方式（默认仅 email） */
  methods?: LoginMethod[];
}

export interface LoginSuccess {
  mode: LoginMode;
  user?: { id: string; email: string; name?: string; emailVerified?: boolean } | null;
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
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [name, setName] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  // 注册 OTP：true = 已发码，等待输入验证码
  // 统一模式：老用户密码登录 / 新用户验证码注册
  const [otpStep, setOtpStep] = createSignal(false);
  const [otp, setOtp] = createSignal("");

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (password().length < 8) {
      setError("密码至少 8 位");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(props.config.loginOrOtpEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // 登录/注册不无限"提交中"：15s 超时 → 网络错误提示
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          email: email().trim(),
          password: password(),
          name: name().trim() || email().trim().split("@")[0],
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
        setError(getLoginErrorMessage(data, res.status));
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { user?: LoginSuccess["user"]; token?: string | null; needOtp?: boolean }
        | null;
      // 新用户：进入验证码输入
      if (body?.needOtp) {
        setOtpStep(true);
        return;
      }
      props.onSuccess?.({ mode: "signin", user: body?.user ?? null, token: body?.token ?? null });
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

  /** 注册 OTP 验证：校验验证码 → 创建用户（带密码）→ 自动登录 */
  const verifyOtp = async (e: SubmitEvent) => {
    e.preventDefault();
    if (otp().trim().length < 6) {
      setError("请输入 6 位验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(props.config.otpCompleteEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({
          email: email().trim(),
          otp: otp().trim(),
          password: password(),
          name: name().trim() || email().trim().split("@")[0],
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
        setError(getLoginErrorMessage(data, res.status));
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { user?: LoginSuccess["user"]; token?: string | null }
        | null;
      props.onSuccess?.({ mode: "signup", user: body?.user ?? null, token: body?.token ?? null });
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
        <div {...stylex.props(styles.brand)}>dailog</div>
        <div {...stylex.props(styles.tagline)}>把你的 AI 对话，变成你的播客</div>
        <div>
          <div {...stylex.props(styles.tabs)}>
            <span {...stylex.props(styles.tab, styles.tabActive)}>
              登录 / 注册（新用户将收到邮箱验证码）
            </span>
          </div>
              <Show
                when={!otpStep()}
                fallback={
                  /* 注册 OTP 验证码输入（发码后） */
                  <form onSubmit={verifyOtp}>
                    <div {...stylex.props(styles.noticeText)}>
                      验证码已发送至 <b>{email().trim()}</b>，请输入 6 位验证码完成注册。
                    </div>
                    <TextField
                      label="验证码"
                      type="text"
                      value={otp()}
                      onInput={setOtp}
                      placeholder="6 位数字"
                      autocomplete="one-time-code"
                    />
                    <Button type="submit" block disabled={busy()}>
                      {busy() ? "验证中…" : "完成注册"}
                    </Button>
                    <Button
                      block
                      appear="ghost"
                      disabled={busy()}
                      onClick={() => setOtpStep(false)}
                    >
                      返回修改邮箱
                    </Button>
                    <Show when={error()}>
                      <div {...stylex.props(styles.error)}>{error()}</div>
                    </Show>
                  </form>
                }
              >
                <form onSubmit={submit}>
                  <div {...stylex.props(styles.nameField)}>
                    <label {...stylex.props(styles.nameLabel)}>昵称（可选）</label>
                    <input
                      {...stylex.props(styles.nameInput)}
                      value={name()}
                      onInput={(e) => setName(e.currentTarget.value)}
                      autocomplete="nickname"
                    />
                  </div>
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
                    autocomplete="new-password"
                  />
                  <Button type="submit" block disabled={busy()}>
                    {busy() ? "提交中…" : "登录"}
                  </Button>
                  <Show when={error()}>
                    <div {...stylex.props(styles.error)}>{error()}</div>
                  </Show>
                  <div {...stylex.props(styles.hint)}>注册需邮箱验证码 · 邀请码用于开通频道</div>
                </form>
              </Show>
        </div>
      </Card>
    </div>
  );
}
