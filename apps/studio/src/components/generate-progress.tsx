import { createSignal, onCleanup, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex.ts";
import { api } from "../lib/client";
import { ApiError } from "../lib/api";

export interface JobInfo {
  id: string;
  status: "queued" | "tts" | "merge" | "upload" | "done" | "failed";
  progress: number;
  error: string | null;
}

const STAGE_LABEL: Record<JobInfo["status"], string> = {
  queued: "排队中",
  tts: "合成语音",
  merge: "拼接片头片尾",
  upload: "上传存储",
  done: "完成",
  failed: "生成失败",
};

export interface GenerateProgressProps {
  episodeId: string;
  /** 生成完成（含试听就绪） */
  onDone?: () => void;
  onFailed?: (error: string) => void;
  onQuotaDenied?: () => void;
}

export default function GenerateProgress(props: GenerateProgressProps) {
  const [job, setJob] = createSignal<JobInfo | null>(null);
  const [started, setStarted] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [audioUrl, setAudioUrl] = createSignal<string | null>(null);
  const [quotaDenied, setQuotaDenied] = createSignal(false);

  const trigger = async () => {
    setStarted(true);
    setError(null);
    setQuotaDenied(false);
    try {
      await api.post(`/api/episodes/${props.episodeId}/generate`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setQuotaDenied(true);
        return;
      }
      if (e instanceof ApiError && e.status === 422) {
        setError(`内容安全审核未通过：${e.detail ?? "请修改脚本后重试"}`);
        return;
      }
      setError(e instanceof Error ? e.message : "触发生成失败");
      return;
    }
    poll();
  };

  const poll = async () => {
    while (true) {
      try {
        const j = await api.get<JobInfo>(`/api/episodes/${props.episodeId}/job`);
        setJob(j);
        if (j.status === "done") {
          props.onDone?.();
          loadAudio();
          return;
        }
        if (j.status === "failed") {
          props.onFailed?.(j.error ?? "未知错误");
          return;
        }
      } catch (e) {
        // 轮询瞬断（job 刚创建）忽略，下一拍重试
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const loadAudio = async () => {
    try {
      const res = await api.request(`/api/episodes/${props.episodeId}/audio`);
      if (!res.ok) return;
      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
    } catch {
      // 音频加载失败：试听区保持隐藏
    }
  };

  onCleanup(() => {
    const url = audioUrl();
    if (url) URL.revokeObjectURL(url);
  });

  const progress = () => job()?.progress ?? 0;
  const status = () => job()?.status ?? "queued";

  return (
    <div>
      <Show when={!started()}>
        <div {...stylex.props(styles.box)}>
          <div {...stylex.props(styles.title)}>生成播客音频</div>
          <div {...stylex.props(styles.hint)}>
            将用你的克隆声音（主持人）和平台固定声音（AI 嘉宾）合成并拼接片头片尾。大约需要 1-3 分钟。
          </div>
          <button {...stylex.props(styles.button)} onClick={trigger}>
            开始生成
          </button>
        </div>
      </Show>

      <Show when={started() && !job()}>
        <div {...stylex.props(styles.box)}>
          <div {...stylex.props(styles.title)}>任务已提交，等待队列…</div>
        </div>
      </Show>

      <Show when={job() && status() !== "done" && status() !== "failed"}>
        <div {...stylex.props(styles.box)}>
          <div {...stylex.props(styles.title)}>{STAGE_LABEL[status()]}（{progress()}%）</div>
          <div {...stylex.props(styles.bar)}>
            <div
              {...stylex.props(styles.barInner)}
              style={`width: ${Math.max(2, progress())}%`}
            />
          </div>
        </div>
      </Show>

      <Show when={error()}>
        <div {...stylex.props(styles.errorBox)}>
          <div {...stylex.props(styles.errorText)}>{error()}</div>
          <button {...stylex.props(styles.button)} onClick={trigger}>
            重试
          </button>
        </div>
      </Show>

      <Show when={quotaDenied()}>
        <div {...stylex.props(styles.errorBox)}>
          <div {...stylex.props(styles.errorText)}>
            免费额度已用完。购买积分或订阅 Pro 后可继续生成（支付功能即将上线）。
          </div>
          <button {...stylex.props(styles.buttonGhost)} onClick={() => props.onQuotaDenied?.()}>
            返回修改脚本
          </button>
        </div>
      </Show>

      <Show when={audioUrl()}>
        <div {...stylex.props(styles.box)}>
          <div {...stylex.props(styles.title)}>试听你的节目</div>
          <audio controls src={audioUrl()!} {...stylex.props(styles.audio)} />
        </div>
      </Show>
    </div>
  );
}

const styles = stylex.create({
  box: {
    padding: tokens.space5,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space3,
  },
  title: {
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space2,
  },
  hint: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
    marginBottom: tokens.space3,
    lineHeight: 1.6,
  },
  button: {
    padding: `${tokens.space2} ${tokens.space5}`,
    borderRadius: tokens.radiusMd,
    border: "none",
    background: tokens.colorPrimary,
    color: "#fff",
    cursor: "pointer",
    fontSize: tokens.fontSizeMd,
  },
  buttonGhost: {
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    color: tokens.colorText,
    padding: `${tokens.space2} ${tokens.space5}`,
    borderRadius: tokens.radiusMd,
    cursor: "pointer",
  },
  bar: {
    height: "8px",
    borderRadius: tokens.radiusFull,
    background: tokens.colorBg,
    overflow: "hidden",
  },
  barInner: {
    height: "100%",
    background: tokens.colorPrimary,
    transition: "width 0.5s ease",
  },
  errorBox: {
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.colorDanger}`,
    background: tokens.colorSurface,
    marginBottom: tokens.space3,
  },
  errorText: {
    color: tokens.colorDanger,
    fontSize: tokens.fontSizeMd,
    marginBottom: tokens.space3,
    lineHeight: 1.6,
  },
  audio: {
    width: "100%",
  },
});
