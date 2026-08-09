import { createSignal, onMount, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import Recorder from "../components/recorder";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";
import { uploadVoiceSample, HOST_READING_SCRIPT } from "../lib/voice";

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing6,
  },
  card: {
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing4,
  },
  cardTitle: {
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  cardDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing3,
    lineHeight: 1.6,
  },
  status: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    marginTop: dimensions.spacing2,
  },
  statusOk: {
    color: colors.success,
  },
  statusFail: {
    color: colors.danger,
  },
  placeholder: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
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
      await uploadVoiceSample(b, HOST_READING_SCRIPT); // 重录同样照固定文案读
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
          <Button block style={{ "margin-top": dimensions.spacing3 }} onClick={submit} disabled={!blob() || busy()}>{busy() ? "上传训练中…" : "保存新声音"}</Button>
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
