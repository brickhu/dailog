import { createSignal, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, TextField } from "@dailogues/ui";

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
    border: `1px solid ${colors.ink}`,
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
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email())) return setMsg({ ok: false, text: "请输入有效的邮箱地址" });
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forget-password/email-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email().trim().toLowerCase() }),
      });
      if (res.ok) {
        setStep("code");
        setMsg({ ok: true, text: "验证码已发送——请查收邮件（10 分钟内有效）" });
      } else {
        setMsg({ ok: false, text: "发送失败，请稍后重试" });
      }
    } finally {
      setBusy(false);
    }
  };

  /** ② 验证码 + 新密码重置 */
  const resetPassword = async () => {
    setMsg(null);
    if (newPw().length < 8) return setMsg({ ok: false, text: "新密码至少 8 位" });
    if (newPw() !== confirmPw()) return setMsg({ ok: false, text: "两次输入的新密码不一致" });
    setBusy(true);
    try {
      const res = await fetch("/api/auth/email-otp/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email().trim().toLowerCase(), otp: otp(), password: newPw() }),
      });
      if (res.ok) {
        setMsg({ ok: true, text: "密码已重置，正在跳转登录…" });
        setTimeout(() => (window.location.href = "/login"), 1200);
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMsg({ ok: false, text: body?.message ?? "重置失败——验证码可能已过期或不正确" });
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
            <div {...stylex.props(styles.title)}>重置密码</div>
            <div {...stylex.props(styles.desc)}>
              输入发送到 {email()} 的 6 位验证码，并设置新密码。
            </div>
            <div {...stylex.props(styles.field)}>
              <TextField label="验证码" value={otp()} onInput={setOtp} placeholder="验证码" maxLength={6} />
            </div>
            <div {...stylex.props(styles.field)}>
              <TextField label="新密码" type="password" value={newPw()} onInput={setNewPw} placeholder="新密码（至少 8 位）" />
            </div>
            <div {...stylex.props(styles.field)}>
              <TextField label="确认新密码" type="password" value={confirmPw()} onInput={setConfirmPw} placeholder="再次输入新密码" />
            </div>
            <Button block onClick={resetPassword} disabled={busy()}>{busy() ? "重置中…" : "重置密码"}</Button>
            <Show when={msg()}>
              <div {...stylex.props(msg()!.ok ? styles.success : styles.error)}>{msg()!.text}</div>
            </Show>
            <a href="/forgot-password" {...stylex.props(styles.back)}>← 重新发送验证码</a>
          </>
        }>
          <div {...stylex.props(styles.title)}>找回密码</div>
          <div {...stylex.props(styles.desc)}>
            输入注册邮箱，我们将发送 6 位验证码帮你重置密码。
          </div>
          <div {...stylex.props(styles.field)}>
            <TextField label="邮箱" type="email" value={email()} onInput={setEmail} placeholder="注册邮箱" />
          </div>
          <Button block onClick={sendCode} disabled={busy()}>{busy() ? "发送中…" : "发送验证码"}</Button>
          <Show when={msg()}>
            <div {...stylex.props(msg()!.ok ? styles.success : styles.error)}>{msg()!.text}</div>
          </Show>
          <a href="/login" {...stylex.props(styles.back)}>← 返回登录</a>
        </Show>
      </div>
    </div>
  );
}
