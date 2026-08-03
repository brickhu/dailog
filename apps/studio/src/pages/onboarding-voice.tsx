import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import Recorder from "../components/recorder";
import { ApiError } from "../lib/api";
import { uploadVoiceSample } from "../lib/voice";

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
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  desc: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeMd,
    marginBottom: tokens.space4,
    lineHeight: 1.6,
  },
  tip: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space3,
  },
  error: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
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
    marginTop: tokens.space4,
  },
  submitDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
});

export default function OnboardingVoice() {
  const navigate = useNavigate();
  const [blob, setBlob] = createSignal<Blob | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const submit = async () => {
    const b = blob();
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      // multipart 上传：api 侧创建 Fish fast 音色模型（5-8s 训练），失败 502 降级提示
      await uploadVoiceSample(b);
      navigate("/dashboard");
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
          {...stylex.props(styles.submit, (!blob() || busy()) && styles.submitDisabled)}
          onClick={submit}
          disabled={!blob() || busy()}
        >
          {busy() ? "训练音色中…" : "完成，进入工作台"}
        </button>
        <div {...stylex.props(styles.tip)}>之后随时可以在设置页重录</div>
      </div>
    </div>
  );
}
