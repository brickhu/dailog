// 声音采样录制弹窗（单视图：朗读文案 + 录音条三态 = 未录音 / 录音中 / 预览）：
//  - **组件只负责录音**：采样语种（language）与朗读文案（script）由调用方解析后经 props 传入
//    —— 弹窗内不提供语种切换、不提供文案编辑，也不做任何网络请求
//  - 录音完成（点「保存」）→ onSubmit 回调把音频交回调用方，上传等业务逻辑由调用方处理
//    （busy 由调用方控制：处理中禁用保存/取消并显示加载态）
//  - 录音中：取消 / 保存禁用，Escape 与关闭请求被忽略（由 onOpenChange 守卫）
//  - 保存门槛（「录音不合法不能保存」）：已录到音频 + 时长 ≥ MIN_SECONDS，否则保存禁用
//  - 朗读文案固定只读，随录音经 onSubmit 交回（零样本克隆的参考文本 transcript）
//  - 录音引擎（getUserMedia + MediaRecorder + 波形 canvas + 计时 + 自动停止）沿用既有实现
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, Icon } from "@dailogues/ui";
import { colors, dimensions, typography } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { usePlayback } from "../lib/playback";

export type RecorderPhase = "idle" | "recording" | "preview";

/** 录音完成产物（交回调用方做上传等业务处理；组件本身不碰网络） */
export interface RecordedSample {
  /** 录音音频 */
  blob: Blob;
  /** 录音时长（秒） */
  duration: number;
  /** 采样语种（= language prop） */
  language: string;
  /** 朗读文案（= script prop；零样本克隆的参考文本） */
  transcript: string;
}

export interface VoiceSampleRecorderDialogProps {
  open: boolean;
  /** 采样语种（调用方决定，弹窗内不可切换） */
  language: string;
  /** 朗读文案（调用方解析后的最终文本；弹窗内不可编辑） */
  script: string;
  /** 调用方业务处理中（上传等）：保存/取消禁用 + 保存按钮加载态 */
  busy?: boolean;
  onClose: () => void;
  /** 取消事件：点击「取消」按钮时触发（录音中/处理中按钮禁用，不会触发） */
  onCancel?: () => void;
  /** 录音完成（点「保存」）→ 业务逻辑（上传采样等）由调用方实现 */
  onSubmit: (sample: RecordedSample) => void;
}

const MIN_SECONDS = 5;
const MAX_SECONDS = 30;
/** 取色失败时的兜底（= onSurface 亮色值；极端情况不会走到） */
const WAVEFORM_FALLBACK = "#161b22";

export default function VoiceSampleRecorderDialog(props: VoiceSampleRecorderDialogProps) {
  const { t } = useI18n();
  const playback = usePlayback();

  const [phase, setPhase] = createSignal<RecorderPhase>("idle");
  const [seconds, setSeconds] = createSignal(0);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [playing, setPlaying] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId = 0;
  let analyser: AnalyserNode | null = null;
  let audioCtx: AudioContext | null = null;
  let blobRef: Blob | null = null;
  let audio: HTMLAudioElement | null = null;

  const busy = () => props.busy === true;

  const stopTracks = () => {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    // analyser 必须一起清掉：否则下一次录音时它仍是上一轮的陈旧引用，
    // 会让画布在"刚创建、还没插入文档"时就开始绘制（见 drawWaveform 的 isConnected 说明）
    analyser = null;
    if (audioCtx) {
      void audioCtx.close().catch(() => { /* 关闭失败不影响录音 */ });
      audioCtx = null;
    }
    if (timer) clearInterval(timer);
    timer = null;
    if (finalizeTimer) clearTimeout(finalizeTimer);
    finalizeTimer = null;
  };

  const cleanupPreview = () => {
    const url = previewUrl();
    if (url) URL.revokeObjectURL(url);
    setPreviewUrl(null);
    blobRef = null;
  };

  // ---- 预览态试听（blob URL；播放时暂停全局播放器防串音）----
  const ensureAudio = () => {
    if (audio || typeof document === "undefined") return audio;
    const a = new Audio();
    a.addEventListener("playing", () => setPlaying(true));
    a.addEventListener("pause", () => setPlaying(false));
    a.addEventListener("ended", () => { setPlaying(false); playback.resume(); });
    a.addEventListener("error", () => { setPlaying(false); playback.resume(); });
    audio = a;
    return a;
  };

  // 录音副本变化（重录）→ 重新加载音源
  createEffect(() => {
    const url = previewUrl();
    if (!url || typeof document === "undefined") return;
    const a = ensureAudio();
    if (!a) return;
    if (a.src !== url) {
      a.src = url;
      a.load();
    }
  });

  const stopPreviewAudio = () => {
    audio?.pause();
    setPlaying(false);
  };

  const togglePreview = () => {
    const a = ensureAudio();
    if (!a || !previewUrl()) return;
    if (a.paused) {
      playback.pause();
      setPlaying(true);
      void a.play().catch(() => {
        setPlaying(false);
        playback.resume();
      });
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  /** 复位到「未录音」（丢弃当前录音） */
  const reset = () => {
    stopTracks();
    cancelAnimationFrame(rafId);
    cleanupPreview();
    stopPreviewAudio();
    setSeconds(0);
    setError(null);
    setPhase("idle");
  };

  // 打开/关闭只在 open 状态切换时处理：打开 → 复位；关闭 → 清理引擎 + 恢复全局播放
  let wasOpen = false;
  createEffect(() => {
    const open = props.open;
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      reset();
    } else {
      stopTracks();
      cancelAnimationFrame(rafId);
      cleanupPreview();
      stopPreviewAudio();
      playback.resume();
    }
  });

  const start = async () => {
    setError(null);
    cleanupPreview();
    stopPreviewAudio();
    setSeconds(0);
    // 非安全上下文（http + 非 localhost）时 mediaDevices 为 undefined——明确提示
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t("recorder.envUnsupported"));
      return;
    }
    playback.pause(); // 录音防串音：暂停全局播放（resume 见 stop/关闭）
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setError((e as DOMException)?.name === "NotAllowedError" ? t("recorder.permissionDenied") : t("recorder.micError"));
      return;
    }
    mediaRecorder = new MediaRecorder(stream);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = () => finalizeBlob();
    mediaRecorder.start();
    setPhase("recording");
    // 计时 + 自动停止
    const t0 = Date.now();
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
    // 音量波形可视化
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    drawWaveform();
  };

  /** 从已收集的 chunks 生成录音（onstop 与兜底共用；已生成则跳过）。
   *  无数据 → 回「未录音」并报错（录音不合法，不允许保存）。 */
  const finalizeBlob = () => {
    if (blobRef) return;
    if (chunks.length === 0) {
      setError(t("recorder.recordFailed"));
      setPhase("idle");
      setSeconds(0);
      return;
    }
    const b = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
    blobRef = b;
    setPreviewUrl(URL.createObjectURL(b));
    setPhase("preview");
  };

  /** 按语种粗估完整朗读文案所需秒数（软校验用；CJK ~4.5 字/秒，拉丁 ~14 字符/秒） */
  const estimateReadingSeconds = (): number => {
    const len = (props.script || "").trim().length;
    if (!len) return 0;
    return Math.round(len / (/^(zh|ja|ko)$/.test(props.language) ? 4.5 : 14));
  };

  /** 录音明显短于完整朗读预期时长（< 50%）→ 提示重录（非阻断，时长合法即可保存） */
  const tooShort = () => {
    if (phase() !== "preview" || seconds() < MIN_SECONDS) return false;
    const expected = estimateReadingSeconds();
    return expected > 0 && seconds() < expected * 0.5;
  };

  const stop = () => {
    if (phase() !== "recording") return;
    mediaRecorder?.stop();
    stopTracks();
    // onstop 兜底：部分浏览器 stop() 后立即停轨会吞掉 stop 事件 → 500ms 后用已收集数据生成
    finalizeTimer = setTimeout(() => finalizeBlob(), 500);
    playback.resume(); // 录音结束恢复播放（仅当录音前在播时）
  };

  /** 预览态「重录」→ 回到未录音（丢弃当前录音） */
  const reRecord = () => {
    reset();
    playback.resume();
  };

  /** 保存闸门：已录到音频 + 时长合法（未录音/录音中/时长不足 → 禁用） */
  const canSave = () => phase() === "preview" && !!blobRef && !!previewUrl() && seconds() >= MIN_SECONDS;

  /** 录音完成 → 交回调用方（本组件不做上传等业务处理） */
  const submit = () => {
    if (busy() || !canSave() || !blobRef) return;
    props.onSubmit({
      blob: blobRef,
      duration: seconds(),
      language: props.language,
      transcript: props.script ?? "",
    });
  };

  /** 面状波形：以中线对称的实心柱条（每个采样点一条）；填充色取主题色（canvas 的 color） */
  const drawWaveform = () => {
    const canvas = waveformRef;
    if (!canvas || !analyser) return;
    // 画布尚未插入文档（ref 在元素创建时即触发，可能早于插入）：
    // 此时 getComputedStyle 拿到的是默认黑、clientWidth 也是 0 —— 推迟到插入后的下一帧，
    // 既不缓存错误的填充色，也不按错误尺寸建 backing store（重录后变黑条的根因）
    if (!canvas.isConnected) {
      rafId = requestAnimationFrame(drawWaveform);
      return;
    }
    // backing store 跟随实际布局尺寸（插入后才量得到；尺寸未变则不动，避免每帧清空画布）
    const cw = Math.max(160, Math.round(canvas.clientWidth || 320));
    const ch = Math.max(24, Math.round(canvas.clientHeight || 36));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext("2d")!;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    if (!waveColor) {
      // 取画布 color（onSurface）的实际计算值；非法值回退常量，避免 fillStyle 赋值被静默忽略而画成黑条
      const c = getComputedStyle(canvas).color;
      waveColor = /^(rgb|rgba|#|hsl)/.test(c) ? c : WAVEFORM_FALLBACK;
    }
    ctx.fillStyle = waveColor;
    const step = w / data.length;
    const barWidth = Math.max(1, step - 0.6);
    for (let i = 0; i < data.length; i++) {
      // 时域值 128 = 静音中点 → 振幅 0..1
      const amp = Math.abs(data[i] / 128 - 1);
      const barHeight = Math.max(2, amp * h * 0.92);
      ctx.fillRect(i * step, mid - barHeight / 2, barWidth, barHeight);
    }
    rafId = requestAnimationFrame(drawWaveform);
  };

  let waveformRef: HTMLCanvasElement | undefined;
  let waveColor: string | null = null; // 主题填充色缓存（画布挂载时失效并重取）
  const setWaveformRef = (el: HTMLCanvasElement) => {
    waveformRef = el;
    if (el) {
      waveColor = null; // 画布重新挂载 → 取色缓存失效，重新按当前 color（onSurface）取
      // 录制态画布挂载后再启动绘制（start() 同步调用时画布尚未渲染，drawWaveform 会空跑）
      if (analyser && phase() === "recording") drawWaveform();
    }
  };

  onCleanup(() => {
    stopTracks();
    cancelAnimationFrame(rafId);
    cleanupPreview();
    if (audio) {
      audio.pause();
      audio = null;
    }
  });

  return (
    <Dialog
      isOpen={props.open}
      /* 录音中 / 调用方处理中忽略关闭请求（Escape / 关闭）：Dialog 只上报意图，是否关闭由消费方决定 */
      onOpenChange={(v) => { if (!v && phase() !== "recording" && !busy()) props.onClose(); }}
      width={540}
      purpose="form"
      padding={5}
    >
      <div {...stylex.props(styles.wrap)}>
        <h2 {...stylex.props(styles.title)}>{t("recorder.dialogTitle")}</h2>
        <p {...stylex.props(styles.hint)}>{t("recorder.prepareHint")}</p>

        {/* 朗读文本区（固定只读；语种与文案均由调用方传入） */}
        <div {...stylex.props(styles.scriptBox)}>
          <div {...stylex.props(styles.scriptLabel)}>
            {t("recorder.scriptLangPrefix", { lang: t(("lang." + props.language) as never) })}
          </div>
          <p {...stylex.props(styles.script)}>{props.script}</p>
        </div>

        {/* 录音条 —— 未录音：[麦克风] [提示] [录音圆点按钮] */}
        <Show when={phase() === "idle"}>
          <div {...stylex.props(styles.bar)}>
            <span {...stylex.props(styles.barIcon)} aria-hidden="true"><Icon icon="mdi:microphone" /></span>
            <span {...stylex.props(typography.bodyMd, styles.barText)}>
              {t("recorder.startHint", { minSeconds: MIN_SECONDS })}
            </span>
            <Button
              round="full"
              variant="brand"
              isIconOnly
              label={t("recorder.start")}
              icon={<Icon icon="mdi:record" />}
              onClick={() => void start()}
            />
          </div>
        </Show>

        {/* 录音条 —— 录音中：[呼吸圆点] [音量波纹] [计时 + 停止圆钮] */}
        <Show when={phase() === "recording"}>
          <div {...stylex.props(styles.bar)}>
            <span {...stylex.props(styles.pulseDot)} aria-hidden="true" />
            <canvas ref={setWaveformRef} {...stylex.props(styles.waveform)} />
            <span {...stylex.props(typography.bodyMd, styles.timer)}>
              {t("recorder.recordingCount", { seconds: seconds(), maxSeconds: MAX_SECONDS })}
            </span>
            <Button
              round="full"
              variant="danger"
              isIconOnly
              label={t("recorder.recording")}
              icon={<Icon icon="mdi:stop" />}
              onClick={stop}
            />
          </div>
        </Show>

        {/* 录音条 —— 预览：[播放圆钮] [N秒] [重录按钮] */}
        <Show when={phase() === "preview"}>
          <div {...stylex.props(styles.bar)}>
            <Button
              round="full"
              variant="brand"
              isIconOnly
              label={playing() ? t("common.pause") : t("common.play")}
              icon={<Icon icon={playing() ? "mdi:pause" : "mdi:play"} />}
              onClick={togglePreview}
            />
            <Show
              when={seconds() < MIN_SECONDS}
              fallback={
                <span {...stylex.props(typography.caption, styles.barText)}>
                  {t("recorder.durationSeconds", { seconds: seconds() })}
                </span>
              }
            >
              {/* 录音不合法（时长不足）：状态文案区直接给原因，保存按钮禁用 */}
              <span {...stylex.props(typography.caption, styles.barText, styles.barTextDanger)}>
                {t("recorder.recorded", { seconds: seconds(), minSeconds: MIN_SECONDS })}
              </span>
            </Show>
            <Button
              appear="ghost"
              size="sm"
              label={t("recorder.retry")}
              icon={<Icon icon="mdi:refresh" />}
              onClick={reRecord}
              isDisabled={busy()}
            />
          </div>
        </Show>

        {/* 偏短软提示（时长不足的提示已并入录音条状态文案区） */}
        <Show when={tooShort()}>
          <p {...stylex.props(styles.warn)}>
            {t("recorder.tooShortHint", { actual: seconds(), expected: estimateReadingSeconds() })}
          </p>
        </Show>

        <Show when={error()}>
          <div {...stylex.props(styles.error)} role="alert">{error()}</div>
        </Show>

        {/* 底部操作：取消（录音中/处理中禁用） / 保存（未录音、录音中、录音不合法、处理中禁用） */}
        <div {...stylex.props(styles.footer)}>
          <Button
            appear="ghost"
            onClick={() => props.onCancel?.()}
            isDisabled={busy() || phase() === "recording"}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} isDisabled={!canSave() || busy()} isLoading={busy()}>
            {busy() ? t("recorder.saving") : t("recorder.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

const pulse = stylex.keyframes({
  "0%, 100%": { opacity: 0.3, transform: "scale(0.75)" },
  "50%": { opacity: 1, transform: "scale(1.15)" },
});

const styles = stylex.create({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  title: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  hint: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.6,
  },
  scriptBox: {
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
  },
  scriptLabel: {
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.neutral,
    marginBottom: dimensions.spacing2,
  },
  script: {
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    margin: 0,
  },
  bar: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    color: colors.onSurface,
  },
  barIcon: {
    display: "flex",
    alignItems: "center",
    color: colors.neutral,
    flexShrink: 0,
  },
  // 字号统一走 typography.bodyMd（录音条内文案同一档），此处只管布局与颜色
  barText: {
    flex: "1 1 auto",
    minWidth: 0,
  },
  barTextDanger: {
    color: colors.danger,
  },
  pulseDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    backgroundColor: colors.danger,
    flexShrink: 0,
    animationName: pulse,
    animationDuration: "1.1s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  waveform: {
    flex: "1 1 auto",
    minWidth: 0,
    // 高度与录音条按钮一致（Button md 档 = sizeMd + spacing1 = 36px）
    height: `calc(${dimensions.sizeMd} + ${dimensions.spacing1})`,
    display: "block",
    // 无底色：与录音条表面融为一体；填充色 = onSurface（surface 的对照墨色，亮/暗都清晰）。
    // canvas 的 fillStyle 不能直接用 token 变量 → drawWaveform 用 getComputedStyle 取其实际值
    color: colors.onSurface,
  },
  timer: {
    color: colors.neutral,
    flexShrink: 0,
  },
  warn: {
    color: colors.warning,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: dimensions.spacing3,
    paddingTop: dimensions.spacing3,
    marginTop: dimensions.spacing1,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.6,
  },
});
