// 封面播放卡（统一封面组件）：
// - 结构：底部封面图 + 透明覆盖层 + 右下角圆角图标按钮（全局 Button 组件）
// - 三态：待播放（hover 封面 → play 按钮从下方划入）/ 加载中（disabled + spinner）/
//         播放中（长显 pause 按钮）
// - 状态：playing 受控（外部播放器传入）；loading 组件内部（点击 play → 直到 playing 变
//         true 或超时兜底）——与 playback.play 时序天然匹配（audio.play() pending 期间
//         playing 为 false，就绪后才 true）
// - 事件：onPlay / onPause 暴露，外部接入全局播放器
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Icon } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { DETAIL_COVER_SIZES, episodeCoverSrcset, episodeCoverUrl } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";

/** 加载超时兜底：10s 未进入播放（网络失败等）→ 回待播放态 */
const LOADING_TIMEOUT_MS = 10_000;

const styles = stylex.create({
  wrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: dimensions.radiusLg,
    overflow: "hidden",
    backgroundColor: colors.surface,
    userSelect: "none",
    flexShrink: 0,
  },
  img: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
  },
  // 透明覆盖层：承载 hover（划入 play 按钮）；本身透明无视觉
  overlay: {
    position: "absolute",
    inset: 0,
  },
  placeholder: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceStrong,
    fontSize: "56px",
    color: colors.neutral,
    pointerEvents: "none",
  },
  // 按钮槽：右下角
  btnSlot: {
    position: "absolute",
    right: dimensions.spacing3,
    bottom: dimensions.spacing3,
    zIndex: 1,
  },
  // 待播放：默认藏在封面下方，hover 封面划入；触摸设备（无 hover）常显
  btnIdle: {
    transform: "translateY(110%)",
    opacity: 0,
    transitionProperty: "transform, opacity",
    transitionDuration: "0.25s, 0.2s",
    transitionTimingFunction: "ease",
    "@media (hover: none)": {
      transform: "translateY(0)",
      opacity: 1,
    },
  },
  btnIdleVisible: {
    transform: "translateY(0)",
    opacity: 1,
  },
});

export function Cover(props: {
  /** 节目 meta（id / coverUrl / audioUrl / title 等） */
  episode: QueueEpisode;
  /** 是否播放中（外部受控，来自全局播放器）；true 时 loading 自动结束 */
  playing: boolean;
  /** 待播放点击（组件进入加载中）——外部接入全局播放器 */
  onPlay?: () => void;
  /** 播放中点击暂停——外部接入全局播放器 */
  onPause?: () => void;
  /** 封面 sizes（响应式选图）；缺省详情页档 */
  sizes?: string;
  /** CSS 控制显示大小（透传；默认 width 100% 由父级控制） */
  style?: JSX.CSSProperties;
  class?: string;
}) {
  const { t } = useI18n();
  const [hover, setHover] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  // 仅错误态（图片加载失败 → 占位覆盖）；加载成功不依赖 onLoad——
  // hydration 时序下图片可能先于 onLoad 绑定完成加载，事件丢失会卡在隐藏态
  const [imgError, setImgError] = createSignal(false);

  // playing 变 true → 加载完成；外部停止（false）→ 待播放
  createEffect(() => {
    if (props.playing) setLoading(false);
  });

  // 加载超时兜底：10s 未进入播放 → 回待播放
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (loading()) {
      timer = setTimeout(() => setLoading(false), LOADING_TIMEOUT_MS);
    } else {
      clearTimeout(timer);
    }
  });
  onCleanup(() => clearTimeout(timer));

  const src = () => episodeCoverUrl(props.episode.id, props.episode.coverUrl);
  const handlePlay = () => {
    if (loading()) return;
    setLoading(true);
    props.onPlay?.();
  };

  return (
    <div
      {...stylex.props(styles.wrap)}
      style={props.style}
      class={props.class}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <Show when={src()} fallback={<div {...stylex.props(styles.placeholder)}>🎙</div>}>
        {/* img 始终显示（加载成功自然可见，不依赖 onLoad）；失败时占位覆盖 */}
        <img
          src={episodeCoverUrl(props.episode.id, props.episode.coverUrl, 960)!}
          srcset={episodeCoverSrcset(props.episode.id, props.episode.coverUrl) ?? undefined}
          sizes={props.sizes ?? DETAIL_COVER_SIZES}
          alt={props.episode.title || ""}
          onError={() => setImgError(true)}
          {...stylex.props(styles.img)}
        />
        <Show when={imgError()}>
          <div {...stylex.props(styles.placeholder)}>🎙</div>
        </Show>
      </Show>
      {/* 透明覆盖层（hover 划入按钮的交互载体） */}
      <div {...stylex.props(styles.overlay)} />
      {/* 右下角按钮：播放中 → pause 长显；加载中 → disabled spinner；待播放 → play（hover 划入） */}
      <div {...stylex.props(styles.btnSlot)}>
        <Show when={props.playing}>
          <Button
            round="full"
            size="lg"
            appear="fill"
            variant="brand"
            isIconOnly
            icon={<Icon icon="mdi:pause" width={20} />}
            label={t("common.pause")}
            onClick={props.onPause}
          />
        </Show>
        <Show when={loading() && !props.playing}>
          <Button round="full" size="lg" appear="fill" variant="brand" isIconOnly isLoading label={t("common.play")} />
        </Show>
        <Show when={!props.playing && !loading()}>
          <div {...stylex.props(styles.btnIdle, hover() && styles.btnIdleVisible)}>
            <Button
              round="full"
              size="lg"
              appear="fill"
              variant="brand"
              isIconOnly
              icon={<Icon icon="mdi:play" width={20} />}
              label={t("common.play")}
              onClick={handlePlay}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
