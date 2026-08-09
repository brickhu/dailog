import { createSignal, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import Recorder from "../components/recorder";
import { useAuth } from "../lib/auth";
import { uploadVoiceSample, HOST_READING_SCRIPT } from "../lib/voice";
import { ApiError } from "../lib/api";

// onboarding 锁定视图（AppShell 第二层守卫原地渲染；非独立路由——URL 不变，
// 两步完成后 channel 状态解锁自动回到原始路径）。
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
  stepDone: {
    color: colors.success,
    borderColor: colors.success,
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
  label: {
    display: "block",
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing1,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    background: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
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
  readingScript: {
    background: colors.background,
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
    padding: `${dimensions.spacing3} ${dimensions.spacing4}`,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.8,
    marginBottom: dimensions.spacing4,
  },
  readingLabel: {
    color: colors.primary,
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
});

export default function Onboarding() {
  const auth = useAuth();
  // 已开通用户访问 = 重录入口（守卫放行），直接进录音步；未开通从授权码步开始
  const [step, setStep] = createSignal<1 | 2>(auth.channelActive() ? 2 : 1);
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
    setBusy(true);
    setError(null);
    try {
      // context 统一管理频道状态：成功后 channelActive=true，守卫自动跳工作台（无需手动 navigate）
      const { error, code } = await auth.activateChannel(c);
      if (error) {
        setError(code === "invalid_invite_code" ? "授权码无效或已被使用" : error);
        return;
      }
      setStep(2);
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
      // 样本 + 固定朗读文案（转录文本）一起上传：零样本克隆质量依赖转录准确性
      await uploadVoiceSample(b, HOST_READING_SCRIPT);
      // 样本保存成功即完成 onboarding（样本直传模式，无训练环节）：
      // hasVoiceSample 解锁 → 守卫自动放行回原始路径（URL 不变，无需导航）
      auth.markVoiceSampleUploaded();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        auth.expireSession(); // 会话失效：清本地状态 → 登录锁定自动出现
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
                播客里"你"的声音将由这段录音克隆生成。找个安静环境，照着下面的文字读一遍（10–15 秒）。
              </div>
              <div {...stylex.props(styles.readingScript)}>
                <div {...stylex.props(styles.readingLabel)}>请朗读：</div>
                {HOST_READING_SCRIPT}
              </div>
              <Recorder onReady={(b) => setBlob(b)} busy={busy()} />
              <Show when={error()}>
                <div {...stylex.props(styles.error)}>{error()}</div>
              </Show>
              <Button block disabled={!blob() || busy()} onClick={submitVoice}>{busy() ? "训练音色中…" : "完成，进入工作台"}</Button>
              <div {...stylex.props(styles.tip)}>之后随时可以在设置页重录</div>
            </>
          }
        >
          <div {...stylex.props(styles.title)}>开通你的频道</div>
          <div {...stylex.props(styles.desc)}>
            任何人都可以注册 dailog，但只有输入授权码开通频道后，才能生成和发布节目。
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
            <Button block type="submit" disabled={busy()}>{busy() ? "开通中…" : "开通频道"}</Button>
            <Button block appear="ghost" disabled={busy()} onClick={() => auth.signOut()}>
              退出登录
            </Button>
          </form>
        </Show>
      </div>
    </div>
  );
}
