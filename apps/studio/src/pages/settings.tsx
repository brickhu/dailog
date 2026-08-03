import { createSignal, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@dailogues/ui/theme.stylex";
import Recorder from "../components/recorder";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { uploadVoiceSample } from "../lib/voice";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    background: tokens.colorBg,
    color: tokens.colorText,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space5,
  },
  card: {
    padding: tokens.space5,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space4,
  },
  cardTitle: {
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  cardDesc: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space3,
    lineHeight: 1.6,
  },
  status: {
    fontSize: tokens.fontSizeSm,
    color: tokens.colorTextMuted,
    marginTop: tokens.space2,
  },
  statusOk: {
    color: tokens.colorSuccess,
  },
  statusFail: {
    color: tokens.colorDanger,
  },
  placeholder: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  button: {
    padding: `${tokens.space2} ${tokens.space4}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
    marginTop: tokens.space3,
  },
  error: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeSm,
    marginTop: tokens.space2,
  },
});

export default function Settings() {
  const [blob, setBlob] = createSignal<Blob | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [sample, setSample] = createSignal<{ status: string; duration: number } | null>(null);

  onMount(async () => {
    try {
      const s = await api.get<{ status: string; duration: number }>("/api/me/voice-sample");
      setSample(s);
    } catch {
      // 从未录制：sample 保持 null
    }
  });

  const submit = async () => {
    const b = blob();
    if (!b) return;
    setBusy(true);
    setError(null);
    try {
      await uploadVoiceSample(b);
      setSample({ status: "ready", duration: 0 });
    } catch (e) {
      if (e instanceof ApiError && e.status === 502) {
        setError("音色模型训练失败（可能是 Fish 额度不足）。已保存录音，后续可重试。");
      } else {
        setError(e instanceof Error ? e.message : "上传失败");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>设置</div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>你的声音</div>
          <div {...stylex.props(styles.cardDesc)}>
            重录后立即生效（fast 训练 5-8 秒）。用于生成节目中"你"的声音。
          </div>
          <Recorder onReady={(b) => setBlob(b)} busy={busy()} />
          <Show when={sample()}>
            <div {...stylex.props(styles.status, sample()!.status === "ready" ? styles.statusOk : styles.statusFail)}>
              当前样本：{sample()!.status === "ready" ? "已就绪 ✓" : "训练失败，请重录"}
            </div>
          </Show>
          <Show when={error()}>
            <div {...stylex.props(styles.error)}>{error()}</div>
          </Show>
          <button {...stylex.props(styles.button)} onClick={submit} disabled={!blob() || busy()}>
            {busy() ? "上传训练中…" : "保存新声音"}
          </button>
        </div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>邀请码</div>
          <div {...stylex.props(styles.placeholder)}>
            发布满 3 期后，每发布一期获得一个邀请码（功能即将上线）
          </div>
        </div>

        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.cardTitle)}>订阅</div>
          <div {...stylex.props(styles.placeholder)}>
            免费用户可生成 1 期；Pro 订阅无限生成（支付功能即将上线）
          </div>
        </div>
      </div>
    </div>
  );
}
