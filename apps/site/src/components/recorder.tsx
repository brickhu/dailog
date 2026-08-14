import { createSignal, onCleanup, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { usePlayback } from "../lib/playback";

// ---------------------------------------------------------------------------
// 录音状态机（纯函数，可单测）
// ---------------------------------------------------------------------------

export type RecorderPhase = "idle" | "recording" | "recorded";

export type RecorderEvent =
  | { type: "start" } // 开始录音（recorded 态可直接覆盖重录）
  | { type: "stop" } // 手动/自动停止
  | { type: "discard" }; // 丢弃重录

export function recorderReducer(phase: RecorderPhase, event: RecorderEvent): RecorderPhase {
  switch (event.type) {
    case "start":
      return "recording";
    case "stop":
      return phase === "recording" ? "recorded" : phase;
    case "discard":
      return "idle";
  }
}

// ---------------------------------------------------------------------------
// 录音器组件（getUserMedia + MediaRecorder + 波形 canvas）
// ---------------------------------------------------------------------------

export interface RecorderProps {
  /** 最短可提交秒数（不达标提交按钮禁用） */
  minSeconds?: number;
  /** 自动停止秒数 */
  maxSeconds?: number;
  onReady?: (blob: Blob) => void;
  /** 父级状态（上传中）；busy 时禁用操作 */
  busy?: boolean;
}

export default function Recorder(props: RecorderProps) {
  const { t } = useI18n();
  const playback = usePlayback();
  const minSeconds = props.minSeconds ?? 8;
  const maxSeconds = props.maxSeconds ?? 30;
  const [phase, setPhase] = createSignal<RecorderPhase>("idle");
  const [seconds, setSeconds] = createSignal(0);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let rafId = 0;
  let analyser: AnalyserNode | null = null;

  const stopTracks = () => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (timer) clearInterval(timer);
    timer = null;
  };

  const cleanupPreview = () => {
    const url = previewUrl();
    if (url) URL.revokeObjectURL(url);
    setPreviewUrl(null);
  };

  const start = async () => {
    setError(null);
    cleanupPreview();
    setSeconds(0);
    // 非安全上下文（http + 非 localhost）时 mediaDevices 为 undefined——明确提示而不是笼统的"授权失败"
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(t("recorder.envUnsupported"));
      return;
    }
    playback.pause(); // 录音防串音：暂停全局播放（resume 见 stop/discard）
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
    mediaRecorder.onstop = () => {
      const b = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
      setPreviewUrl(URL.createObjectURL(b));
      props.onReady?.(b);
    };
    mediaRecorder.start();
    setPhase(recorderReducer(phase(), { type: "start" }));
    // 计时 + 自动停止
    const t0 = Date.now();
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= maxSeconds) stop();
    }, 250);
    // 波形可视化
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    drawWaveform();
  };

  const stop = () => {
    if (phase() !== "recording") return;
    mediaRecorder?.stop();
    setPhase(recorderReducer(phase(), { type: "stop" }));
    stopTracks();
    playback.resume(); // 录音结束恢复播放（仅当录音前在播时）
  };

  const discard = () => {
    stopTracks();
    cleanupPreview();
    setSeconds(0);
    setPhase(recorderReducer(phase(), { type: "discard" }));
    playback.resume(); // 取消录音恢复播放
  };

  const drawWaveform = () => {
    const canvas = waveformRef;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d")!;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#5b8cff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * canvas.width;
      const y = (data[i] / 255) * canvas.height;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    rafId = requestAnimationFrame(drawWaveform);
  };

  let waveformRef: HTMLCanvasElement | undefined;
  const setWaveformRef = (el: HTMLCanvasElement) => {
    waveformRef = el;
    if (el) {
      el.width = 320;
      el.height = 64;
    }
  };

  onCleanup(() => {
    stopTracks();
    cancelAnimationFrame(rafId);
    cleanupPreview();
  });

  return (
    <div {...stylex.props(styles.box)}>
      <canvas ref={setWaveformRef} {...stylex.props(styles.waveform)} />
      <div {...stylex.props(styles.timer)}>
        {phase() === "recording" && <>{seconds()}s / {maxSeconds}s 最长</>}
        {phase() === "recorded" && <>{seconds()}s（{seconds() < minSeconds ? `至少 ${minSeconds} 秒` : "可以了 ✓"}）</>}
        {phase() === "idle" && <>{t("recorder.recordingHint")}</>}
      </div>
      <div {...stylex.props(styles.controls)}>
        <Show when={phase() !== "recording"}>
          <Button onClick={start} disabled={props.busy}>{phase() === "recorded" ? t("recorder.retry") : t("recorder.start")}</Button>
        </Show>
        <Show when={phase() === "recording"}>
          <Button onClick={stop}>{t("recorder.recording")}</Button>
        </Show>
        <Show when={phase() === "recorded"}>
          <Button appear="ghost" onClick={discard} disabled={props.busy}>{t("recorder.discard")}</Button>
          <audio controls src={previewUrl() ?? undefined} {...stylex.props(styles.audio)} />
        </Show>
      </div>
      <Show when={error()}>
        <div {...stylex.props(styles.error)}>{error()}</div>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  box: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
  },
  waveform: {
    width: "100%",
    height: "64px",
    display: "block",
    backgroundColor: colors.surface,
    borderRadius: dimensions.radiusSm,
    marginBottom: dimensions.spacing2,
  },
  timer: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginBottom: dimensions.spacing3,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    flexWrap: "wrap",
  },
  audio: {
    height: "40px",
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing2,
  },
});
