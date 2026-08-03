import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import Recorder from "../components/recorder";
import { authApi } from "../lib/auth-api";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { uploadVoiceSample } from "../lib/voice";

// /app/onboarding：两步流程——① 授权码开通频道 ② 录声音样本（都完成 → /app/episodes）
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
    maxWidth: "560px",
    padding: tokens.space6,
    borderRadius: tokens.radiusLg,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
  },
  steps: {
    display: "flex",
    gap: tokens.space2,
    marginBottom: tokens.space5,
    fontSize: tokens.fontSizeSm,
  },
  step: {
    color: tokens.colorTextMuted,
    padding: `${tokens.space1} ${tokens.space3}`,
    borderRadius: tokens.radiusFull,
    border: `1px solid ${tokens.colorBorder}`,
  },
  stepActive: {
    color: tokens.colorPrimary,
    borderColor: tokens.colorPrimary,
  },
  stepDone: {
    color: tokens.colorSuccess,
    borderColor: tokens.colorSuccess,
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
  buttonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  error: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
  },
  tip: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space3,
  },
});

export default function Onboarding() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = createSignal<1 | 2>(1);
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [blob, setBlob] = createSignal<Blob | null>(null);

  const activateChannel = async (e: SubmitEvent) => {
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
      setStep(2);
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

  const submitVoice = async () => {
    const b = blob();
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      await uploadVoiceSample(b);
      navigate("/episodes");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setError("登录状态已失效，请重新登录后再试");
      } else if (e instanceof ApiError && e.status === 502) {
        setError("音色模型训练失败（可能是 Fish 额度不足）。你仍然可以继续，但声音效果会打折扣。");
      } else {
        setError(e instanceof Error ? e.message : "上传失败，请重试");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.steps)}>
          <span {...stylex.props(styles.step, step() === 1 && styles.stepActive, step() > 1 && styles.stepDone)}>
            ① 开通频道
          </span>
          <span {...stylex.props(styles.step, step() === 2 && styles.stepActive)}>② 录你的声音</span>
        </div>

        <Show
          when={step() === 1}
          fallback={
            <>
              <div {...stylex.props(styles.title)}>录一段你的声音</div>
              <div {...stylex.props(styles.desc)}>
                播客里"你"的声音将由这段录音克隆生成。找个安静环境，像和朋友聊天一样说 10–30
                秒：自我介绍、今天发生的事都行。
              </div>
              <Recorder onReady={(b) => setBlob(b)} busy={busy()} />
              <Show when={error()}>
                <div {...stylex.props(styles.error)}>{error()}</div>
              </Show>
              <button
                {...stylex.props(styles.button, (!blob() || busy()) && styles.buttonDisabled)}
                onClick={submitVoice}
                disabled={!blob() || busy()}
              >
                {busy() ? "训练音色中…" : "完成，进入工作台"}
              </button>
              <div {...stylex.props(styles.tip)}>之后随时可以在设置页重录</div>
            </>
          }
        >
          <div {...stylex.props(styles.title)}>开通你的频道</div>
          <div {...stylex.props(styles.desc)}>
            任何人都可以注册 dailogues，但只有输入授权码开通频道后，才能生成和发布节目。
            授权码来自邀请你的朋友或社区活动。
          </div>
          <form onSubmit={activateChannel}>
            <label {...stylex.props(styles.label)}>授权码</label>
            <input
              {...stylex.props(styles.input)}
              value={code()}
              onInput={(e) => setCode(e.currentTarget.value)}
              placeholder="输入授权码"
              autocomplete="off"
            />
            <Show when={error()}>
              <div {...stylex.props(styles.error)}>{error()}</div>
            </Show>
            <button type="submit" {...stylex.props(styles.button)} disabled={busy()}>
              {busy() ? "开通中…" : "开通频道"}
            </button>
          </form>
        </Show>
      </div>
    </div>
  );
}
