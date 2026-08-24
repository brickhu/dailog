// 声音采样预览条：XX秒XX语采样 + 播放/暂停 + 重录。
//  - 本地 audio 元素播放（录制 blob URL 或同源代理 /v1/me/voice-sample/audio）
//  - 播放时暂停全局播放器防串音；暂停/播完/出错恢复（playback.resume 仅在暂停前在播时续播）
//  - 语种显示名走 i18n（lang.<code>）；时长缺省/为 0 时只显示语种（兼容历史 duration=0 数据）
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Icon } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { usePlayback } from "../lib/playback";

export interface VoiceSamplePreviewProps {
  /** 采样秒数（缺省/0 时只显示语种） */
  duration?: number | null;
  /** 采样语种 code（ISO 639-1）——「XX语」标签 */
  language: string;
  /** 试听地址：同源代理 URL（/v1/me/voice-sample/audio）或录制 blob URL */
  audioUrl: string;
  /** 重录回调（打开录音弹窗）；缺省不显示重录按钮 */
  onReRecord?: () => void;
  /** 上传中等忙态：禁用重录 */
  busy?: boolean;
}

export default function VoiceSamplePreview(props: VoiceSamplePreviewProps) {
  const { t } = useI18n();
  const playback = usePlayback();
  const [playing, setPlaying] = createSignal(false);

  let audio: HTMLAudioElement | null = null;

  // 懒建 audio + 事件绑定（客户端 only；SSR 不建元素）
  createEffect(() => {
    if (typeof document === "undefined") return;
    const a = new Audio();
    audio = a;
    // 真正出声（"playing"）才置 true——按钮切到暂停；pause/ended/error 回 false
    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      playback.resume();
    };
    const onError = () => {
      setPlaying(false);
      playback.resume();
    };
    a.addEventListener("playing", onPlaying);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    onCleanup(() => {
      a.pause();
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      audio = null;
      playback.resume(); // 卸载时仍在试听 → 恢复全局播放（仅暂停前在播时）
    });
  });

  // 试听地址变化 → 重新加载（重录后 blob URL 更新）
  createEffect(() => {
    const url = props.audioUrl;
    const a = audio;
    if (!url || !a) return;
    if (a.src !== url) {
      a.src = url;
      a.load();
    }
  });

  const toggle = () => {
    const a = audio;
    if (!a) return;
    if (a.paused) {
      playback.pause(); // 试听防串音：暂停全局播放（播完/暂停恢复）
      setPlaying(true); // 立即反馈（缓冲中也是暂停态；失败由 catch/error 事件回退）
      void a.play().catch(() => {
        setPlaying(false);
        playback.resume();
      });
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const summary = () => {
    const lang = t("lang." + props.language as never);
    const d = props.duration;
    if (d && d > 0) return t("voiceSample.summary", { seconds: Math.round(d), lang });
    return t("voiceSample.summaryNoDuration", { lang });
  };

  return (
    <div {...stylex.props(styles.bar)}>
      <span {...stylex.props(styles.summary)}>{summary()}</span>
      <Button
        round="full"
        size="sm"
        variant="brand"
        isIconOnly
        label={playing() ? t("common.pause") : t("common.play")}
        icon={<Icon icon={playing() ? "mdi:pause" : "mdi:play"} />}
        onClick={toggle}
      />
      <Show when={props.onReRecord}>
        <Button
          appear="ghost"
          size="sm"
          label={t("recorder.retry")}
          icon={<Icon icon="mdi:refresh" />}
          onClick={props.onReRecord}
          isDisabled={props.busy}
        />
      </Show>
    </div>
  );
}

const styles = stylex.create({
  bar: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
  },
  summary: {
    flex: 1,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.foreground,
  },
});
