import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { authApi } from "../lib/auth-api";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: tokens.colorBg,
    color: tokens.colorText,
    padding: tokens.space4,
  },
  card: {
    width: "100%",
    maxWidth: "480px",
    padding: tokens.space6,
    borderRadius: tokens.radiusLg,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  desc: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeMd,
    lineHeight: 1.7,
    marginBottom: tokens.space5,
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
  button: {
    width: "100%",
    padding: `${tokens.space2} ${tokens.space3}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    fontSize: tokens.fontSizeMd,
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    marginTop: tokens.space3,
  },
  skip: {
    display: "block",
    textAlign: "center",
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space3,
    background: "none",
    border: "none",
    cursor: "pointer",
    width: "100%",
  },
  error: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
  },
  success: {
    color: tokens.colorSuccess,
    fontSize: tokens.fontSizeMd,
    marginTop: tokens.space3,
    textAlign: "center",
  },
});

export default function OnboardingChannel() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    const c = code().trim();
    if (!c) {
      setError("请输入授权码");
      return;
    }
    const token = auth.token();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.activateChannel(token, c);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_invite_code") {
        setError("授权码无效或已被使用");
      } else {
        setError(err instanceof Error ? err.message : "开通失败，请重试");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.title)}>开通你的频道</div>
        <div {...stylex.props(styles.desc)}>
          任何人都可以注册 dailogues，但只有输入邀请码开通频道后，才能生成和发布节目。
          邀请码来自邀请你的朋友或社区活动。
        </div>
        <Show
          when={!done()}
          fallback={
            <>
              <div {...stylex.props(styles.success)}>频道已开通 ✓</div>
              <button {...stylex.props(styles.button)} onClick={() => navigate("/onboarding/voice")}>
                下一步：录制你的声音
              </button>
            </>
          }
        >
          <form onSubmit={submit}>
            <label {...stylex.props(styles.label)}>授权码</label>
            <input
              {...stylex.props(styles.input)}
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              placeholder="输入邀请码"
              autocomplete="off"
            />
            <Show when={error()}>
              <div {...stylex.props(styles.error)}>{error()}</div>
            </Show>
            <button type="submit" {...stylex.props(styles.button)} disabled={busy()}>
              {busy() ? "开通中…" : "开通频道"}
            </button>
          </form>
          <button {...stylex.props(styles.skip)} onClick={() => navigate("/dashboard")}>
            稍后开通，先去逛逛 →
          </button>
        </Show>
      </div>
    </div>
  );
}
