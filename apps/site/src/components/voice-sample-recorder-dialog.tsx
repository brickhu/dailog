// 声音采样录制弹窗（准备录制 → 录制中 → 预览确认 三态）：
//  - 采样语种与界面语言解耦：语种独立选择（lib/languages.ts）
//  - 当前开放中文/英文切换（ENABLED_SAMPLE_LANGUAGES）；全量语种与内置文案能力已保留
//    （lib/reading-scripts.ts 主流语言内置翻译、小语种回退英文，后续开放即用）
//  - 新增/修改采样都从「准备录制」态打开（mode 仅影响标题文案）
//  - 确认保存时上传 /v1/me/voice-sample（file + transcript + language + duration）
//  - 取消按钮触发 onCancel（丢弃当前录音并关闭，由父级决定是否关闭）
//  - 录音引擎（getUserMedia + MediaRecorder + 波形 canvas + 自动停止）从旧 recorder.tsx 迁入
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, Icon, Spinner } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { usePlayback } from "../lib/playback";
import { ENABLED_SAMPLE_LANGUAGES, isSupportedSampleLanguage } from "../lib/languages";
import { getReadingScript } from "../lib/reading-scripts";
import VoiceSamplePreview from "./voice-sample-preview";

export type RecorderPhase = "prepare" | "recording" | "confirm";

export interface SavedSample {
  sampleId: string;
  language: string;
  duration: number;
  transcript: string | null;
}

export interface VoiceSampleRecorderDialogProps {
  open: boolean;
  /** add = 新增采样；edit = 修改采样（仅影响标题） */
  mode?: "add" | "edit";
  /** 采样语种默认值（修改采样传已有语种；新增可省略，默认界面语言） */
  defaultLanguage?: string;
  /** 朗读文案中的称呼（主持人昵称） */
  hostName?: string;
  onClose: () => void;
  /** 取消事件：点击「取消」按钮时触发（丢弃当前录音；是否关闭由父级决定） */
  onCancel?: () => void;
  onSaved: (sample: SavedSample) => void;
}

const MIN_SECONDS = 8;
const MAX_SECONDS = 30;

export default function VoiceSampleRecorderDialog(props: VoiceSampleRecorderDialogProps) {
  const { t, locale } = useI18n();
  const playback = usePlayback();

  const [phase, setPhase] = createSignal<RecorderPhase>("prepare");
  const [selectedLang, setSelectedLang] = createSignal<string>("zh");
  const [script, setScript] = createSignal("");
  const [scriptIsFallback, setScriptIsFallback] = createSignal(false);
  const [scriptLang, setScriptLang] = createSignal<string>("zh"); // 文案实际语种（回退时 en）
  const [seconds, setSeconds] = createSignal(0);
  const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: BlobPart[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  let rafId = 0;
  let analyser: AnalyserNode | null = null;
  let blobRef: Blob | null = null;
  // 录音开始时正在朗读的文案（= 预览确认后上传的 transcript，与展示文本严格一致）
  let transcriptRef: string | null = null;

  const stopTracks = () => {
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
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

  /** 按语种取朗读文案（同步）：主流语言内置翻译，小语种回退英文 */
  const updateScript = (lang: string) => {
    const name = (props.hostName || "").trim() || t("submit.hostFallback");
    const r = getReadingScript(lang, name);
    setScript(r.text);
    setScriptIsFallback(r.isFallback);
    setScriptLang(r.lang);
  };

  const selectLang = (lang: string) => {
    if (lang === selectedLang()) return;
    setSelectedLang(lang);
    updateScript(lang);
  };

  const reset = () => {
    stopTracks();
    cancelAnimationFrame(rafId);
    cleanupPreview();
    setSeconds(0);
    setError(null);
    setSaving(false);
    setPhase("prepare");
    transcriptRef = null;
  };

  // 打开/关闭只在 open 状态切换时处理（不追踪 defaultLanguage/locale——
  // 父级异步 fetch 完成后这些值会变，若重跑 reset() 会清掉正在进行的录音/预览）
  let wasOpen = false;
  createEffect(() => {
    const open = props.open;
    if (open === wasOpen) return;
    wasOpen = open;
    if (open) {
      // 打开 → 复位到「准备录制」并加载默认语种文案
      const lang = isSupportedSampleLanguage(props.defaultLanguage)
        ? props.defaultLanguage!
        : locale() === "en" ? "en" : "zh";
      setSelectedLang(lang);
      reset();
      updateScript(lang);
    } else {
      // 关闭（含录音中强制关闭）→ 清理引擎
      stopTracks();
      cancelAnimationFrame(rafId);
      cleanupPreview();
      playback.resume();
    }
  });

  const start = async () => {
    setError(null);
    cleanupPreview();
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
    transcriptRef = script(); // 记录此刻展示的文案（用户正在朗读它）
    // 计时 + 自动停止
    const t0 = Date.now();
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
    // 波形可视化
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    drawWaveform();
  };

  /** 从已收集的 chunks 生成录音（onstop 与兜底共用；已生成则跳过） */
  const finalizeBlob = () => {
    if (blobRef) return;
    if (chunks.length === 0) {
      setError(t("recorder.recordFailed"));
      return;
    }
    const b = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
    blobRef = b;
    setPreviewUrl(URL.createObjectURL(b));
    setPhase("confirm");
  };

  /** 按语种粗估完整朗读文案所需秒数（软校验用；CJK ~4.5 字/秒，拉丁 ~14 字符/秒） */
  const estimateReadingSeconds = (lang: string, text: string): number => {
    const len = (text || "").trim().length;
    if (!len) return 0;
    return Math.round(len / (/^(zh|ja|ko)$/.test(lang) ? 4.5 : 14));
  };

  /** 录音明显短于完整朗读预期时长（< 50%）→ 提示重录（非阻断，可照常保存） */
  const tooShort = () => {
    if (phase() !== "confirm" || seconds() < MIN_SECONDS) return false;
    const expected = estimateReadingSeconds(scriptLang(), transcriptRef ?? script());
    return expected > 0 && seconds() < expected * 0.5;
  };

  const stop = () => {
    if (phase() !== "recording") return;
    mediaRecorder?.stop();
    setPhase("confirm");
    stopTracks();
    // onstop 兜底：部分浏览器 stop() 后立即停轨会吞掉 stop 事件 → 500ms 后用已收集数据生成
    finalizeTimer = setTimeout(() => finalizeBlob(), 500);
    playback.resume(); // 录音结束恢复播放（仅当录音前在播时）
  };

  /** 预览确认 → 返回准备录制（可换语种/换文案/重录） */
  const goPrepare = () => {
    stopTracks();
    cleanupPreview();
    setSeconds(0);
    transcriptRef = null;
    setPhase("prepare");
    playback.resume();
  };

  const save = async () => {
    if (saving()) return;
    if (!blobRef || !previewUrl()) {
      setError(t("recorder.recordFailed"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", blobRef, "voice.webm");
      form.append("transcript", transcriptRef ?? "");
      form.append("language", selectedLang());
      form.append("duration", String(seconds()));
      const res = await fetch("/v1/me/voice-sample", { method: "POST", body: form });
      if (!res.ok) {
        setError(t("recorder.uploadFailed"));
        return;
      }
      const data = (await res.json().catch(() => null)) as { sampleId?: string } | null;
      props.onSaved({
        sampleId: data?.sampleId ?? "",
        language: selectedLang(),
        duration: seconds(),
        transcript: transcriptRef,
      });
    } catch {
      setError(t("recorder.uploadFailed"));
    } finally {
      setSaving(false);
    }
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
      // 录制态画布挂载后再启动绘制（start() 同步调用时画布尚未渲染，drawWaveform 会空跑）
      if (analyser && phase() === "recording") drawWaveform();
    }
  };

  onCleanup(() => {
    stopTracks();
    cancelAnimationFrame(rafId);
    cleanupPreview();
  });

  return (
    <Dialog isOpen={props.open} onOpenChange={(v) => !v && props.onClose()} width={540} purpose="form" padding={5}>
      <div {...stylex.props(styles.wrap)}>
        <h2 {...stylex.props(styles.title)}>
          {props.mode === "edit" ? t("recorder.dialogTitleEdit") : t("recorder.dialogTitle")}
        </h2>

        {/* ---- 准备录制：语种选择 + 朗读文案 + 开始 ---- */}
        <Show when={phase() === "prepare"}>
          <div {...stylex.props(styles.langLabel)}>{t("recorder.langLabel")}</div>
          <div {...stylex.props(styles.langRow)} role="group" aria-label={t("recorder.langLabel")}>
            {ENABLED_SAMPLE_LANGUAGES.map((l) => (
              <button
                type="button"
                {...stylex.props(styles.langChip, selectedLang() === l && styles.langChipActive)}
                aria-pressed={selectedLang() === l}
                onClick={() => selectLang(l)}
              >
                {t("lang." + l as never)}
              </button>
            ))}
          </div>
          <p {...stylex.props(styles.hint)}>{t("recorder.prepareHint")}</p>
          <ScriptBlock
            script={script()}
            lang={scriptLang()}
            isFallback={scriptIsFallback()}
            editable
            onChange={setScript}
          />
          <p {...stylex.props(styles.hint)}>{t("recorder.scriptEditHint")}</p>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={start} disabled={saving()}>
              <Icon icon="mdi:record" /> {t("recorder.start")}
            </Button>
          </div>
        </Show>

        {/* ---- 录制中：文案 + 波形 + 计时 + 停止 ---- */}
        <Show when={phase() === "recording"}>
          <ScriptBlock
            script={script()}
            lang={scriptLang()}
            isFallback={scriptIsFallback()}
            muted
          />
          <canvas ref={setWaveformRef} {...stylex.props(styles.waveform)} />
          <div {...stylex.props(styles.timer)}>{t("recorder.recordingCount", { seconds: seconds(), maxSeconds: MAX_SECONDS })}</div>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={stop} variant="danger">
              <Icon icon="mdi:stop" /> {t("recorder.recording")}
            </Button>
          </div>
        </Show>

        {/* ---- 预览确认：试听 + 重录 + 保存 ---- */}
        <Show when={phase() === "confirm"}>
          <p {...stylex.props(styles.hint)}>{t("recorder.confirmHint")}</p>
          <Show when={previewUrl()} fallback={<div {...stylex.props(styles.loading)}><Spinner /></div>}>
            <VoiceSamplePreview
              duration={seconds()}
              language={selectedLang()}
              audioUrl={previewUrl()!}
              onReRecord={goPrepare}
            />
          </Show>
          <Show when={seconds() < MIN_SECONDS}>
            <p {...stylex.props(styles.error)}>{t("recorder.recorded", { seconds: seconds(), minSeconds: MIN_SECONDS })}</p>
          </Show>
          <Show when={tooShort()}>
            <p {...stylex.props(styles.warn)}>
              {t("recorder.tooShortHint", {
                actual: seconds(),
                expected: estimateReadingSeconds(scriptLang(), transcriptRef ?? script()),
              })}
            </p>
          </Show>
          <div {...stylex.props(styles.actions)}>
            <Button appear="ghost" onClick={goPrepare} disabled={saving()}>{t("recorder.backToPrepare")}</Button>
            <Button onClick={save} isDisabled={saving() || seconds() < MIN_SECONDS} isLoading={saving()}>
              {saving() ? t("recorder.saving") : t("recorder.save")}
            </Button>
          </div>
        </Show>

        {/* 底部操作：取消（任意状态可用；保存中禁用） */}
        <div {...stylex.props(styles.footer)}>
          <Button appear="ghost" onClick={() => props.onCancel?.()} isDisabled={saving()}>
            {t("common.cancel")}
          </Button>
        </div>

        <Show when={error()}>
          <div {...stylex.props(styles.error)} role="alert">{error()}</div>
        </Show>
      </div>
    </Dialog>
  );
}

/** 朗读文案块（准备/录制两态共用）；lang=文案实际语种（回退时 en），isFallback=小语种回退提示。
 *  editable=true（准备录制态）渲染可编辑 textarea——用户可修改文案，修改后按新文案朗读并随采样保存。 */
function ScriptBlock(props: { script: string; lang: string; isFallback: boolean; muted?: boolean; editable?: boolean; onChange?: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div {...stylex.props(styles.scriptBox)}>
      <div {...stylex.props(styles.scriptLabel)}>
        {t("recorder.scriptLabel")}
        <span {...stylex.props(styles.scriptLangTag)}>{t("lang." + props.lang as never)}</span>
      </div>
      <Show
        when={props.editable}
        fallback={<p {...stylex.props(styles.script, props.muted && styles.scriptMuted)}>{props.script}</p>}
      >
        <textarea
          {...stylex.props(styles.scriptTextarea)}
          value={props.script}
          maxLength={300}
          rows={3}
          onInput={(e) => props.onChange?.(e.currentTarget.value)}
        />
      </Show>
      <Show when={props.isFallback}>
        <p {...stylex.props(styles.warn)}>{t("recorder.scriptFallback")}</p>
      </Show>
    </div>
  );
}

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
  langLabel: {
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.neutral,
  },
  langRow: {
    display: "flex",
    gap: dimensions.spacing2,
    overflowX: "auto",
    paddingBottom: dimensions.spacing1,
  },
  langChip: {
    flex: "0 0 auto",
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    borderStyle: "solid",
    borderWidth: dimensions.borderWidthThin,
    borderColor: colors.ink,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  langChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
    color: colors.onPrimary,
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
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.neutral,
    marginBottom: dimensions.spacing2,
  },
  scriptLangTag: {
    marginLeft: dimensions.spacing2,
    padding: `0 ${dimensions.spacing1}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    color: colors.neutral,
    fontSize: dimensions.fontSizeXs,
  },
  script: {
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    margin: 0,
  },
  scriptMuted: {
    color: colors.neutral,
  },
  scriptTextarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    padding: dimensions.spacing2,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    borderStyle: "solid",
    borderWidth: dimensions.borderWidthThin,
    borderColor: colors.ink,
  },
  warn: {
    color: colors.warning,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    marginTop: dimensions.spacing2,
  },
  waveform: {
    width: "100%",
    height: "64px",
    display: "block",
    backgroundColor: colors.surface,
    borderRadius: dimensions.radiusSm,
  },
  timer: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    borderTopStyle: "solid",
    borderTopWidth: dimensions.borderWidthThin,
    borderTopColor: colors.ink,
    paddingTop: dimensions.spacing3,
    marginTop: dimensions.spacing1,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.6,
  },
  loading: {
    textAlign: "center",
    padding: dimensions.spacing4,
    color: colors.neutral,
  },
});
