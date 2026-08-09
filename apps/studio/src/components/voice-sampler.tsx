import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import Recorder from "./recorder";
import { api } from "../lib/client";
import { HOST_READING_SCRIPT } from "../lib/voice";

// ---------------------------------------------------------------------------
// 声音采样组件（onboarding / settings 共用）：
//   sampleId 存在 → 采样播放视图（可播放 + 「重新采样」按钮）
//   sampleId 为空 → 录音引导视图（文案 + 开始录音）
//   点「重新采样」→ 切换到录音界面；宿主上传成功后更新 sampleId → 自动回到播放视图
// 播放音频经 GET /api/me/voice-sample/audio（带 Bearer/cookie）拉取为 blob URL。
// ---------------------------------------------------------------------------

export interface VoiceSamplerProps {
  /** 已有采样 id（null = 尚无采样）——决定初始视图 */
  sampleId: string | null;
  /** 宿主忙碌（上传中）；忙碌时禁用操作 */
  busy?: boolean;
  /** 录音完成回调（宿主负责上传并更新 sampleId） */
  onSampleReady: (blob: Blob) => void;
}

export default function VoiceSampler(props: VoiceSamplerProps) {
  // 无采样 → 直接进录音视图；有采样 → 播放视图
  const [recording, setRecording] = createSignal(props.sampleId == null);
  const [audioUrl, setAudioUrl] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal(false);
  let objectUrl: string | null = null;

  const revokeUrl = () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    setAudioUrl(null);
  };

  // sampleId 变化 → 切回播放视图并加载采样音频。
  // 注意：effect 只依赖 props.sampleId（不读 recording()）——
  // ① 初次加载：null → 有值 = 已有采样，切播放视图
  // ② 重录上传成功：宿主更新 sampleId → 自动切回播放视图
  // ③ 点「重新采样」只改 recording（不影响 effect）→ 保持录音视图
  createEffect(() => {
    const id = props.sampleId;
    revokeUrl();
    setLoadError(false);
    if (!id) return;
    setRecording(false);
    let cancelled = false;
    api
      .request("/api/me/voice-sample/audio")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    onCleanup(() => {
      cancelled = true;
    });
  });

  onCleanup(revokeUrl);

  return (
    <Show
      when={props.sampleId && !recording()}
      fallback={
        // 录音视图（无采样初始态 / 点击重新采样后）：朗读文案 + 录音器；
        // 有采样（重录场景）时提供「取消」回到播放视图
        <div {...stylex.props(styles.recordBox)}>
          <div {...stylex.props(styles.readingScript)}>
            <div {...stylex.props(styles.readingLabel)}>请朗读：</div>
            {HOST_READING_SCRIPT}
          </div>
          <Recorder onReady={props.onSampleReady} busy={props.busy} />
          <Show when={props.sampleId}>
            <div {...stylex.props(styles.cancelRow)}>
              <Button appear="ghost" onClick={() => setRecording(false)} disabled={props.busy}>取消，保留当前采样</Button>
            </div>
          </Show>
        </div>
      }
    >
      <div {...stylex.props(styles.box)}>
        <div {...stylex.props(styles.label)}>当前采样</div>
        <Show when={audioUrl()} fallback={<div {...stylex.props(styles.status)}>{loadError() ? "采样加载失败，可重新采样" : "加载采样中…"}</div>}>
          <audio controls src={audioUrl() ?? undefined} {...stylex.props(styles.audio)} />
        </Show>
        <div {...stylex.props(styles.actions)}>
          <Button onClick={() => setRecording(true)} disabled={props.busy}>重新采样</Button>
        </div>
      </div>
    </Show>
  );
}

const styles = stylex.create({
  recordBox: {
    marginBottom: dimensions.spacing3,
  },
  cancelRow: {
    marginTop: dimensions.spacing3,
  },
  readingScript: {
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    fontSize: dimensions.fontSizeSm,
    lineHeight: 1.7,
    color: colors.neutral,
    marginBottom: dimensions.spacing3,
  },
  readingLabel: {
    color: colors.primary,
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  box: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
  },
  label: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing2,
  },
  audio: {
    width: "100%",
    height: "40px",
    marginBottom: dimensions.spacing3,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing2,
  },
  status: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing3,
  },
});
