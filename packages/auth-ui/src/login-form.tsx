import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Card, TextField } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { getLoginRedirect, type LoginRedirectOptions } from "./login-redirect";
import { getLoginErrorMessage } from "./error-messages";
import { useI18n } from "@dailogues/i18n";

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
  loading: {
    color: colors.neutral,
    textAlign: "center",
    padding: `${dimensions.spacing8} 0`,
  },
  forgotRow: {
    marginTop: dimensions.spacing2,
    textAlign: "center",
  },
  forgotLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  githubRow: {
    marginTop: dimensions.spacing4,
  },
  githubDivider: {
    display: "block",
    textAlign: "center",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing2,
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

/** 支持的登录方式（业务配置：未来扩展 wechat 时在此声明） */
export type LoginMethod = "email" | "github";

export interface LoginFormConfig {
  /** 统一提交端点：老用户密码登录 / 新用户发验证码（POST { email, password, name? } → { token, user } | { needOtp: true }） */
  loginOrOtpEndpoint: string;
  /** 新用户验证码完成注册（POST { email, otp, password, name? } → { token, user }） */
  otpCompleteEndpoint: string;
  /** 支持的登录方式（默认仅 email） */
  methods?: LoginMethod[];
  /** 找回密码页地址（可选；未配置时不显示"忘记密码"链接）——site 传站内 /forgot-password，studio 传 site 绝对地址 */
  forgotPasswordUrl?: string;
  /** GitHub 登录：sign-in/social 端点（POST）+ 登录成功后的回跳地址（可选；未配置时不显示 GitHub 按钮） */
  github?: { signInSocialEndpoint: string; callbackURL: string };
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
  /** session 确认中（宿主在查 get-session、未决定是否跳转）：true 时渲染 loading 而非表单，防已登录用户看到登录页闪烁 */
  checkingSession?: boolean;
}

/** 跨站统一登录页：完整页面（品牌 + Card + 表单）。配置驱动——业务侧只声明
 *  接口/登录方式/跳转白名单；内部统一流程：POST → 校验 → 成功事件 → 回来源。 */
export function LoginForm(props: LoginFormProps) {
  const { t } = useI18n();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  // 注册 OTP：true = 已发码，等待输入验证码
  // 统一模式：老用户密码登录 / 新用户验证码注册
  const [otpStep, setOtpStep] = createSignal(false);
  const [otp, setOtp] = createSignal("");
  const [githubBusy, setGithubBusy] = createSignal(false);

  /** GitHub 登录：POST sign-in/social → { url } → 跳转授权页（登录后回 callbackURL） */
  const signInGithub = async () => {
    const gh = props.config.github;
    if (!gh || githubBusy()) return;
    setGithubBusy(true);
    setError(null);
    try {
      const res = await fetch(gh.signInSocialEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ provider: "github", callbackURL: gh.callbackURL }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (res.ok && body?.url) {
        window.location.href = body.url;
        return;
      }
      setError(t("auth.githubFailed"));
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setGithubBusy(false);
    }
  };

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (password().length < 8) {
      setError(t("auth.passwordMin"));
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
          name: email().trim().split("@")[0],
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
        setError(getLoginErrorMessage(t, data, res.status));
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
      setError(t("auth.networkError"));
    } finally {
      setBusy(false);
    }
  };

  /** 注册 OTP 验证：校验验证码 → 创建用户（带密码）→ 自动登录 */
  const verifyOtp = async (e: SubmitEvent) => {
    e.preventDefault();
    if (otp().trim().length < 6) {
      setError(t("auth.otpMin"));
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
          name: email().trim().split("@")[0],
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
        setError(getLoginErrorMessage(t, data, res.status));
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
      setError(t("auth.networkError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <Card>
        <div {...stylex.props(styles.brand)}>dailog</div>
        <div {...stylex.props(styles.tagline)}>{t("auth.tagline")}</div>
        <Show when={!props.checkingSession} fallback={<div {...stylex.props(styles.loading)}>{t("auth.loading")}</div>}>
        <div>
          <Show
            when={!otpStep()}
            fallback={
              /* 注册 OTP 验证码输入（发码后） */
              <form onSubmit={verifyOtp}>
                <div {...stylex.props(styles.noticeText)}>
                  {t("auth.otpSent", { email: email().trim() })}
                </div>
                <TextField
                  label={t("auth.otp")}
                  type="text"
                  value={otp()}
                  onInput={setOtp}
                  placeholder={t("auth.otpPlaceholder")}
                  autocomplete="one-time-code"
                />
                <Button type="submit" block disabled={busy()}>
                  {busy() ? t("auth.verifying") : t("auth.completeSignup")}
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
              <TextField
                label={t("auth.email")}
                type="email"
                value={email()}
                onInput={setEmail}
                placeholder="you@example.com"
                autocomplete="email"
              />
                  <TextField
                    label={t("auth.password")}
                    type="password"
                    value={password()}
                    onInput={setPassword}
                    placeholder={t("auth.passwordMin")}
                    autocomplete="new-password"
                  />
                  <Button type="submit" block disabled={busy()}>
                    {busy() ? t("auth.submitting") : t("auth.login")}
                  </Button>
                  <Show when={error()}>
                    <div {...stylex.props(styles.error)}>{error()}</div>
                  </Show>
                  <div {...stylex.props(styles.hint)}>{t("auth.hint")}</div>
                  <Show when={props.config.github}>
                    <div {...stylex.props(styles.githubRow)}>
                      <span {...stylex.props(styles.githubDivider)}>{t("auth.or")}</span>
                      <Button block appear="ghost" onClick={signInGithub} disabled={githubBusy()}>
                        {githubBusy() ? t("auth.githubRedirecting") : t("auth.githubLogin")}
                      </Button>
                    </div>
                  </Show>
                  <Show when={props.config.forgotPasswordUrl}>
                    <div {...stylex.props(styles.forgotRow)}>
                      <a href={props.config.forgotPasswordUrl} {...stylex.props(styles.forgotLink)}>{t("auth.forgotPassword")}</a>
                    </div>
                  </Show>
                </form>
              </Show>
        </div>
        </Show>
      </Card>
    </div>
  );
}
