import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import VoiceSampler from "../components/voice-sampler";
import { useAuth } from "../lib/auth";
import { uploadVoiceSample, HOST_READING_SCRIPT } from "../lib/voice";
import { ApiError } from "../lib/api";
import { useI18n } from "@dailogues/i18n";

// onboarding 锁定视图（AppShell 第二层守卫原地渲染；非独立路由——URL 不变，
// 录音完成后 hasVoiceSample 解锁自动回到原始路径）。
// 邀请码机制已移除：频道自动开通，onboarding 只剩声音采样一步。

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    color: colors.foreground,
    padding: dimensions.spacing4,
  },
  card: {
    width: "100%",
    maxWidth: "560px",
    padding: dimensions.spacing8,
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
  },
  steps: {
    display: "flex",
    gap: dimensions.spacing2,
    marginBottom: dimensions.spacing6,
    fontSize: dimensions.fontSizeSm,
  },
  step: {
    color: colors.neutral,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    border: `1px solid ${colors.ink}`,
  },
  stepActive: {
    color: colors.primary,
    borderColor: colors.primary,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    marginBottom: dimensions.spacing4,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
  tip: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing3,
  },
  signOut: {
    marginTop: dimensions.spacing4,
  },
});

export default function Onboarding() {
  const { t } = useI18n();
  const auth = useAuth();
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const submitVoice = async (b: Blob) => {
    setBusy(true);
    setError(null);
    try {
      // 样本 + 固定朗读文案（转录文本）一起上传：零样本克隆质量依赖转录准确性
      await uploadVoiceSample(b, HOST_READING_SCRIPT);
      // 样本保存成功即完成 onboarding（样本直传模式，无训练环节）：
      // hasVoiceSample 解锁 → 守卫自动放行回原始路径（URL 不变，无需导航）
      auth.markVoiceSampleUploaded();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession(); // 会话失效：清本地状态 → 登录锁定自动出现
      } else {
        setError(e instanceof Error ? e.message : t("studio.onboarding.uploadFailed"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.card)}>
        <div {...stylex.props(styles.steps)}>
          <span {...stylex.props(styles.step, styles.stepActive)}>{t("studio.onboarding.stepVoice")}</span>
        </div>
        <div {...stylex.props(styles.title)}>{t("studio.onboarding.recordTitle")}</div>
        <div {...stylex.props(styles.desc)}>
          播客里"你"的声音将由这段录音克隆生成。找个安静环境，照着下面的文字读一遍（10–15 秒）。
        </div>
        <VoiceSampler sampleId={null} onSampleReady={submitVoice} busy={busy()} />
        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>
        <div {...stylex.props(styles.tip)}>{t("studio.onboarding.retip")}</div>
        <div {...stylex.props(styles.signOut)}>
          <Button block appear="ghost" disabled={busy()} onClick={() => auth.signOut()}>
            退出登录
          </Button>
        </div>
      </div>
    </div>
  );
}
