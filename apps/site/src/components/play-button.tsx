// 播放按钮（PlayButton，独立组件）：从 episode-card 的 PlayControls 抽离，四态合一。
// 状态：播放（play）/ 加载（spinner）/ 暂停（pause）/ 错误（音源不可用 alert）。
// - 自包含：内部接入全局播放器（usePlayback）——传 episode 即可，自动判定当前
//   播放/缓冲/音源错误状态并接管播放/暂停，调用方无需外部接线
// - appear：ghost | fill | outline 三选（缺省 fill，固定外观、不随设备/断点自动切换）；
//   ghost 在封面上附加半透明深底（弱化实心色块，不遮封面）
// - isIconOnly：true 仅显示 播放/加载/暂停/错误 图标（label 作 aria-label）；
//   false 显示 icon + 文字（播放/暂停/加载中/加载错误）
// - label："text"（默认）= 状态文字（播放/暂停/加载中/加载错误）；
//   "duration" = 节目时长（如 "32:05"）——时长不随播放状态变化，按钮宽度天然稳定；
//   读屏 aria 仍用状态文字；无时长时回退状态文字；isIconOnly 时忽略
// - size：对齐 Button 属性（sm/md/lg/xl/xxl），图标随按钮尺寸缩放
// - width：固定按钮宽度（数字=px，字符串原样）——播放/暂停/加载中/加载错误
//   文字长度不同（多语言下差异更大），固定宽度避免按钮随状态切换跳动
// - 文字全部走 useI18n（common.play / pause / loading / loadError，zh/en 词典）——
//   播放/暂停/加载中…/加载错误，多语言自动适配；仅图标时作 aria-label
// - 显隐/定位由使用方决定：PlayButton 自身不管理"鼠标划入才显示"这类显示策略——
//   封面 hover 划入由卡片层（episode-card 包 opacity 容器）实现，列表/详情页常显
// - 点击 stopPropagation：只触发播放/暂停，不冒泡到卡片容器（卡片主体点击才是进详情）
import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import {
  Button,
  Icon,
  Spinner,
  type ButtonAppear,
  type ButtonSize,
  type ButtonVariant,
} from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { usePlayback, type QueueEpisode } from "../lib/playback";
import { fmtDuration } from "../lib/format";

/** 加载超时兜底：10s 未进入播放（网络失败等）→ 回待播放态 */
const LOADING_TIMEOUT_MS = 10_000;
/** 加载中 spinner 最短显示时间：点击后即使音频立即就绪也保留 spinner（防闪——
 * 加载太快时反馈一闪而过，用户以为没反应） */
const MIN_LOADING_MS = 350;

export interface PlayButtonProps {
  /** 节目信息：内部据此判定是否当前播放/音源状态，并接入全局播放器 */
  episode: QueueEpisode;
  /** 外观：ghost / fill / outline @default "fill"（固定外观，不随设备/断点切换） */
  appear?: ButtonAppear;
  /** 仅图标：只显示 播放/加载/暂停/错误 图标；否则 icon + 文字（播放/暂停/加载中/加载错误）
   * @default true */
  isIconOnly?: boolean;
  /** 可见文字：text = 状态文字（播放/暂停/加载中/加载错误）；duration = 节目时长（如 "32:05"），
   * 时长不随播放状态变化、宽度稳定；无时长时回退状态文字；isIconOnly 时忽略 @default "text" */
  label?: "text" | "duration";
  /** 尺寸（对齐 Button 属性）@default "lg" */
  size?: ButtonSize;
  /** 固定按钮宽度：数字=px，字符串原样（如 "100%" / "140px"）；文字状态切换
   * （播放/暂停/加载中/加载错误，多语言长度不同）时保持按钮宽度稳定 @default 自适应 */
  width?: number | string;
  /** 音源不可用覆盖（缺省：无音源/加载失败自动判定） */
  audioError?: boolean;
  /** 缓冲/加载中覆盖（缺省：当前节目全局缓冲状态） */
  buffering?: boolean;
}

/**
 * 播放按钮：play / loading spinner / pause / error（音源不可用）四态。
 * 内部含 loading 状态机（点击 play → 直到 playing 变 true 或超时兜底）——与
 * playback.play 时序天然匹配（audio.play() pending 期间 playing 为 false，
 * 就绪后才 true）。
 */
export function PlayButton(props: PlayButtonProps) {
  const { t } = useI18n();
  const playback = usePlayback();
  const [loading, setLoading] = createSignal(false);
  // 自包含四态：是否当前播放节目（全局播放器）+ 播放/缓冲/错误；可用 props 覆盖
  const isCurrent = () => playback.current()?.id === props.episode.id;
  const playing = () => isCurrent() && playback.playing();
  const buffering = () => props.buffering ?? (isCurrent() && playback.buffering());
  // 无音源判定用 !audioUrl（schema notNull：库里是空串 '' 而非 NULL，== null 永远 false）
  const audioError = () =>
    props.audioError ??
    (!props.episode.audioUrl ||
      (isCurrent() && playback.audioError()) ||
      playback.preloadError() === props.episode.id);
  // 点击时刻（spinner 最短显示时间的计时起点）
  let clickAt = 0;
  // 固定外观（不做设备/断点自动切换）：缺省 fill；需要 ghost/outline 由调用方显式传 appear
  const appear = () => props.appear ?? "fill";
  // ghost 按钮在封面上的可见性：半透明深底（Button xstyle 最后合并覆盖）
  const ghostBg = stylex.create({ base: { backgroundColor: "rgba(0,0,0,0.3)" } });
  const ghostStyle = () => (appear() === "ghost" ? ghostBg.base : undefined);
  const isIconOnly = () => props.isIconOnly ?? true;
  const size = () => props.size ?? "lg";
  // 非仅图标模式的加载 spinner 尺寸：与 Button 内部 iconSizeStyles 对齐
  // （sm/md=16、lg/xl=20、xxl=24）
  const iconPx = () => (size() === "sm" || size() === "md" ? 16 : size() === "xxl" ? 24 : 20);

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

  // 播放就绪（playing → true）时清除 loading，但保证 spinner 最短显示时间：
  // 音频预加载/快速场景下 play() 立即就绪，直接切 pause 会让加载反馈一闪而过
  let minTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    if (playing()) {
      clearTimeout(minTimer);
      const elapsed = performance.now() - clickAt;
      minTimer = setTimeout(() => setLoading(false), Math.max(0, MIN_LOADING_MS - elapsed));
    }
  });
  onCleanup(() => clearTimeout(minTimer));

  // 播放器确认失败（audioError）→ 立即结束本地 loading（不用等 10s 超时）：
  // 点击播放后 404/挂起，audioError 一到就切警告图标，不残留 spinner
  createEffect(() => {
    if (audioError()) setLoading(false);
  });

  // 缓冲结束但从未进入播放（切到别的节目/失败）→ 本地 loading 清除：
  // 点 A 播放后马上点 B，A 的 spinner 不应残留到 10s 超时。
  // 短延迟让 playing 事件先到（正常缓冲就绪时 canplay→playing 几乎同时，
  // 避免闪现 play 按钮）；确未进入播放（切歌/失败）则 120ms 后清 loading
  let sawBuffering = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const b = buffering();
    if (b) {
      sawBuffering = true;
    } else if (sawBuffering && !playing() && loading()) {
      sawBuffering = false;
      stallTimer = setTimeout(() => setLoading(false), 120);
    }
  });
  onCleanup(() => clearTimeout(stallTimer));

  const handlePlay = () => {
    if (loading() || buffering()) return; // 缓冲中不重复触发播放
    clickAt = performance.now();
    setLoading(true);
    playback.play(props.episode);
  };

  // 按钮点击只触发播放/暂停事件，不冒泡到卡片容器（卡片主体点击才是进详情）
  const stop = (fn?: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  // 可见文字：label="duration" 且有时长 → 节目时长（如 "32:05"）；否则状态文字
  const durationText = () =>
    props.label === "duration" && !isIconOnly() && props.episode.durationSeconds
      ? fmtDuration(props.episode.durationSeconds)
      : undefined;

  // 单态按钮渲染：动态 props（size/appear/isIconOnly/xstyle）全部走 JSX 表达式，
  // 保留信号响应性（touch 检测 hydration 后才定）
  const stateBtn = (cfg: {
    variant: ButtonVariant;
    label: string;
    icon?: JSX.Element;
    isLoading?: boolean;
    isDisabled?: boolean;
    onClick?: (e: MouseEvent) => void;
  }) => (
    <Button
      round="full"
      size={size()}
      appear={appear()}
      variant={cfg.variant}
      isIconOnly={isIconOnly()}
      isDisabled={cfg.isDisabled}
      isLoading={cfg.isLoading}
      icon={cfg.icon}
      label={cfg.label}
      width={props.width}
      xstyle={ghostStyle()}
      onClick={cfg.onClick}
    >
      {/* children 覆盖可见文字（时长模式）；label 仍是可访问名（状态文字） */}
      {durationText()}
    </Button>
  );

  return (
    <>
      {/* 音源不可用（无音源/加载失败）：警告图标直接常显——不依赖 hover 划入，
          也不渲染任何播放/暂停/spinner（disabled 按钮，不提供播放） */}
      <Show when={audioError()}>
        {stateBtn({
          variant: "neutral",
          label: t("common.loadError"),
          icon: <Icon icon="mdi:alert" />,
          isDisabled: true,
        })}
      </Show>
      {/* 播放中 → 暂停（最高优先：只要在播就绝不显示 loading——修"在播还转 loading"：
          事件顺序异常（waiting→playing 缺 canplay）时 buffering 可能残留，但音频已在播） */}
      <Show when={!audioError() && playing()}>
        {stateBtn({
          variant: "brand",
          label: t("common.pause"),
          icon: <Icon icon="mdi:pause" />,
          onClick: stop(() => playback.toggle()),
        })}
      </Show>
      {/* 缓冲/加载中（未在播）→ spinner/加载中：仅图标走 Button isLoading
          （自动禁用防误触）；icon+文字走 Spinner 图标 + 「加载中」文本 */}
      <Show when={!audioError() && !playing() && (buffering() || loading())}>
        {isIconOnly()
          ? stateBtn({ variant: "brand", label: t("common.loading"), isLoading: true })
          : stateBtn({
              variant: "brand",
              label: t("common.loading"),
              icon: <Spinner size={iconPx()} shade="inherit" />,
              isDisabled: true,
            })}
      </Show>
      {/* 待播放 → 播放（常显；封面 hover 划入由卡片层包 opacity 容器实现） */}
      <Show when={!audioError() && !playing() && !buffering() && !loading()}>
        {stateBtn({
          variant: "brand",
          label: t("common.play"),
          icon: <Icon icon="mdi:play" />,
          onClick: stop(handlePlay),
        })}
      </Show>
    </>
  );
}
