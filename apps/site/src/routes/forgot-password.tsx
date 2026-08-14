import { A } from "@solidjs/router";
import { useNavigate } from "@solidjs/router";
import { createSignal, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, TextField } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

// 找回密码（dailog.fm/forgot-password）：
// ① 输邮箱 → POST /api/auth/forget-password/email-otp（发 6 位重置码）
// ② 输验证码 + 新密码 → POST /api/auth/email-otp/reset-password → 完成跳登录
// 与注册体验一致（6 位码）；本地无邮件时验证码在 api 日志 [email-otp] 或数据库 verification 表

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
  card: {
    width: "100%",
    maxWidth: "420px",
    padding: dimensions.spacing8,
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing5,
  },
  field: {
    marginBottom: dimensions.spacing3,
  },
  error: {
    color: "#b91c1c",
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
  success: {
    color: "#166534",
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
  back: {
    display: "block",
    marginTop: dimensions.spacing4,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
});

type Step = "email" | "code";

export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [step, setStep] = createSignal<Step>("email");
  const [email, setEmail] = createSignal("");
  const [otp, setOtp] = createSignal("");
  const [newPw, setNewPw] = createSignal("");
  const [confirmPw, setConfirmPw] = createSignal("");
  const [msg, setMsg] = createSignal<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = createSignal(false);

  /** ① 发重置码 */
  const sendCode = async () => {
    setMsg(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email())) return setMsg({ ok: false, text: t("forgot.invalidEmail") });
    setBusy(true);
    try {
      const res = await fetch("/v1/auth/forget-password/email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email().trim().toLowerCase() }),
      });
      if (res.ok) {
        setStep("code");
        setMsg({ ok: true, text: t("forgot.sent") });
      } else {
        setMsg({ ok: false, text: t("forgot.sendFailed") });
      }
    } finally {
      setBusy(false);
    }
  };

  /** ② 验证码 + 新密码重置 */
  const resetPassword = async () => {
    setMsg(null);
    if (newPw().length < 8) return setMsg({ ok: false, text: t("forgot.passwordMin") });
    if (newPw() !== confirmPw()) return setMsg({ ok: false, text: t("forgot.passwordMismatch") });
    setBusy(true);
    try {
      const res = await fetch("/v1/auth/email-otp/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email().trim().toLowerCase(), otp: otp(), password: newPw() }),
      });
      if (res.ok) {
        setMsg({ ok: true, text: t("forgot.resetSuccess") });
        setTimeout(() => navigate("/login"), 1200);
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMsg({ ok: false, text: body?.message ?? t("forgot.resetFailed") });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <Title>找回密码 · dailog</Title>
      <div {...stylex.props(styles.card)}>
        <Show when={step() === "email"} fallback={
          <>
            <div {...stylex.props(styles.title)}>{t("forgot.resetTitle")}</div>
            <div {...stylex.props(styles.desc)}>
              {t("forgot.resetDesc", { email: email() })}
            </div>
            <div {...stylex.props(styles.field)}>
              <TextField label={t("forgot.otp")} value={otp()} onInput={setOtp} placeholder={t("forgot.otp")} maxLength={6} />
            </div>
            <div {...stylex.props(styles.field)}>
              <TextField label="新密码" type="password" value={newPw()} onInput={setNewPw} placeholder={t("forgot.newPassword")} />
            </div>
            <div {...stylex.props(styles.field)}>
              <TextField label="确认新密码" type="password" value={confirmPw()} onInput={setConfirmPw} placeholder={t("forgot.confirmPassword")} />
            </div>
            <Button block onClick={resetPassword} disabled={busy()}>{busy() ? t("forgot.resetting") : t("forgot.reset")}</Button>
            <Show when={msg()}>
              <div {...stylex.props(msg()!.ok ? styles.success : styles.error)}>{msg()!.text}</div>
            </Show>
            <A href="/forgot-password" {...stylex.props(styles.back)}>{t("forgot.resend")}</A>
          </>
        }>
          <div {...stylex.props(styles.title)}>{t("forgot.title")}</div>
          <div {...stylex.props(styles.desc)}>{t("forgot.desc")}</div>
          <div {...stylex.props(styles.field)}>
            <TextField label={t("forgot.email")} type="email" value={email()} onInput={setEmail} placeholder={t("forgot.email")} />
          </div>
          <Button block onClick={sendCode} disabled={busy()}>{busy() ? t("forgot.sending") : t("forgot.send")}</Button>
          <Show when={msg()}>
            <div {...stylex.props(msg()!.ok ? styles.success : styles.error)}>{msg()!.text}</div>
          </Show>
          <A href="/login" {...stylex.props(styles.back)}>{t("forgot.backToLogin")}</A>
        </Show>
      </div>
    </div>
  );
}
