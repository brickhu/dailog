// 节目卡片（三种模式，首页网格/列表/纯封面共用）：
// - compact 精简：只有封面图，不带交互（无按钮/无 hover 划入）
// - grid 网格：封面（PlayControls 三态按钮，hover 划入）+ 标题 + 时间 + 时长，上下排列
// - list 列表：小封面 + 标题/日期 横排，时长 + 三态播放按钮靠右
// - 事件：onPlay/onPause 控制全局播放器；onClick 卡片点击（进详情）；onHover 预取
// 三态播放按钮（PlayControls，导出）在此文件内——cover.tsx 只负责显示图片，
// 按钮定位/划入由使用方决定（grid 封面右下角 / list 右侧 / 详情页封面右下角）
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Button, Icon } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Cover } from "./cover";
import { CARD_COVER_SIZES } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";

const styles = stylex.create({
  // —— grid 网格模式（上下排列）——
  gridCard: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  // 封面槽：封面 + 右下角按钮的定位容器（按钮覆盖在封面上）
  coverSlot: {
    position: "relative",
  },
  // 按钮槽：右下角（grid 封面 / 详情页封面用）。
  // 固定 40×40 + flex：槽高不随内容类型变化（block 容器 vs inline 按钮的行盒高度不同，
  // bottom 锚定下按钮位置会差几像素——三态切换跳动）；按钮统一对齐右下
  btnSlot: {
    position: "absolute",
    right: dimensions.spacing3,
    bottom: dimensions.spacing3,
    zIndex: 1,
    width: dimensions.sizeLg,
    height: dimensions.sizeLg,
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "flex-end",
  },
  // 待播放：默认隐藏（透明），hover 淡入；触摸设备（无 hover）常显。
  // 不用 translateY 位移划入——三态按钮切换时位置必须恒定（位移动画中点击/切换
  // 会让按钮从半路位置跳到最终位置，视觉跳动）
  btnIdle: {
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "0.2s",
    transitionTimingFunction: "ease",
    "@media (hover: none)": {
      opacity: 1,
    },
  },
  btnIdleVisible: {
    opacity: 1,
  },
  title: {
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // 新节目标记：日期前的 brand 色小圆点（isNew=true 时显示）
  newDot: {
    display: "inline-block",
    width: "8px",
    height: "8px",
    marginRight: dimensions.spacing1,
    borderRadius: "50%",
    backgroundColor: colors.brand,
    verticalAlign: "middle",
    flexShrink: 0,
  },
  // —— list 列表模式（横向排列）——
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    cursor: "pointer",
    ":hover": { borderColor: colors.primary },
  },
  listInfo: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
  },
  listRight: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    flexShrink: 0,
  },
  duration: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    fontVariantNumeric: "tabular-nums",
  },
});

/** 加载超时兜底：10s 未进入播放（网络失败等）→ 回待播放态 */
const LOADING_TIMEOUT_MS = 10_000;
/** 加载中 spinner 最短显示时间：点击后即使音频立即就绪也保留 spinner（防闪——
 * 加载太快时反馈一闪而过，用户以为没反应） */
const MIN_LOADING_MS = 350;

/**
 * 三态播放按钮（play / loading spinner / pause）+ loading 状态机。
 * 在 episode-card 内定义（cover 只管图片）；导出供详情页封面复用。
 * - 状态：playing 受控（外部播放器传入）；loading 内部（点击 play → 直到 playing 变
 *   true 或超时兜底）——与 playback.play 时序天然匹配（audio.play() pending 期间
 *   playing 为 false，就绪后才 true）
 * - 定位/划入由使用方决定：grid 封面右下角（revealOnHover + hovered 划入）、
 *   list 右侧常显、详情页封面右下角（revealOnHover）
 * - 点击 stopPropagation：只触发播放/暂停，不冒泡到卡片容器（卡片主体点击才是进详情）
 */
export function PlayControls(props: {
  /** 是否播放中（外部受控）；true 时 loading 自动结束 */
  playing: boolean;
  /** 待播放点击（进入加载中）——外部接入全局播放器 */
  onPlay?: () => void;
  /** 播放中点击暂停——外部接入全局播放器 */
  onPause?: () => void;
  /** 待播放按钮 hover 划入（封面场景）；列表模式常显传 false */
  revealOnHover?: boolean;
  /** hover 状态（revealOnHover 时由外部传入：封面 hover → 划入） */
  hovered?: boolean;
  /** 按钮尺寸（列表模式小一号）@default "lg" */
  size?: "sm" | "md" | "lg";
  /** 按钮外观：缺省自动（触摸设备 ghost / 桌面 fill） */
  appear?: "fill" | "ghost";
}) {
  const { t } = useI18n();
  const [loading, setLoading] = createSignal(false);
  // 点击时刻（spinner 最短显示时间的计时起点）
  let clickAt = 0;
  // 触摸设备（手机/平板无 hover）→ ghost 按钮（半透明底，弱化实心色块）；
  // SSR 端默认 fill（桌面），客户端 hydration 后按 matchMedia 修正
  const [isTouch, setIsTouch] = createSignal(false);
  onMount(() => {
    setIsTouch((typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches) ?? false);
  });
  const appear = () => props.appear ?? (isTouch() ? "ghost" : "fill");
  // ghost 按钮在封面上的可见性：半透明深底（Button xstyle 最后合并覆盖）
  const ghostBg = stylex.create({ base: { backgroundColor: "rgba(0,0,0,0.3)" } });
  const ghostStyle = () => (appear() === "ghost" ? ghostBg.base : undefined);

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
    if (props.playing) {
      clearTimeout(minTimer);
      const elapsed = performance.now() - clickAt;
      minTimer = setTimeout(() => setLoading(false), Math.max(0, MIN_LOADING_MS - elapsed));
    }
  });
  onCleanup(() => clearTimeout(minTimer));

  const handlePlay = () => {
    if (loading()) return;
    clickAt = performance.now();
    setLoading(true);
    props.onPlay?.();
  };

  // 按钮点击只触发播放/暂停事件，不冒泡到卡片容器（卡片主体点击才是进详情）
  const stop = (fn?: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  const btn = (interactive: boolean) => (
    <>
      {/* 播放中（且加载反馈已结束）→ pause */}
      <Show when={props.playing && !loading()}>
        <Button
          round="full"
          size={props.size ?? "lg"}
          appear={appear()}
          variant="brand"
          isIconOnly
          icon={<Icon icon="mdi:pause" width={20} />}
          label={t("common.pause")}
          xstyle={ghostStyle()}
          onClick={stop(props.onPause)}
        />
      </Show>
      {/* 加载中 → spinner（不看 playing：音频就绪瞬间若直接切 pause，最短显示时间失效，
          loading 清掉后（minTimer/超时）才切走） */}
      <Show when={loading()}>
        <Button
          round="full"
          size={props.size ?? "lg"}
          appear={appear()}
          variant="brand"
          isIconOnly
          isLoading
          label={t("common.play")}
          xstyle={ghostStyle()}
        />
      </Show>
      <Show when={!props.playing && !loading()}>
        {interactive ? (
          <div {...stylex.props(styles.btnIdle, props.hovered && styles.btnIdleVisible)}>
            <Button
              round="full"
              size={props.size ?? "lg"}
              appear={appear()}
              variant="brand"
              isIconOnly
              icon={<Icon icon="mdi:play" width={20} />}
              label={t("common.play")}
              xstyle={ghostStyle()}
              onClick={stop(handlePlay)}
            />
          </div>
        ) : (
          <Button
            round="full"
            size={props.size ?? "lg"}
            appear={appear()}
            variant="brand"
            isIconOnly
            icon={<Icon icon="mdi:play" width={20} />}
            label={t("common.play")}
            xstyle={ghostStyle()}
            onClick={stop(handlePlay)}
          />
        )}
      </Show>
    </>
  );

  // 只有一处渲染出口（条件分支都在 btn 内）
  return <>{btn(props.revealOnHover ?? false)}</>;
}

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EpisodeCard(props: {
  /** 节目 meta（id / coverUrl / title / publishedAt / durationSeconds 等） */
  episode: QueueEpisode;
  /** 模式 @default "grid" */
  variant?: "compact" | "grid" | "list";
  /** 是否播放中（外部受控，来自全局播放器） */
  playing: boolean;
  /** 待播放点击（进入加载中）——外部接入全局播放器 */
  onPlay?: () => void;
  /** 播放中点击暂停——外部接入全局播放器 */
  onPause?: () => void;
  /** 卡片主体点击（进详情页） */
  onClick?: () => void;
  /** 卡片 hover（列表页详情预取等） */
  onHover?: () => void;
  /** 新节目标记：true 时日期前显示 brand 色小圆点 @default false */
  isNew?: boolean;
  /** CSS 控制显示大小（透传） */
  style?: JSX.CSSProperties;
  class?: string;
}) {
  const { t, locale } = useI18n();
  const [hover, setHover] = createSignal(false);
  const date = () => {
    const d = props.episode.publishedAt;
    return d ? new Date(d).toLocaleDateString(locale() === "zh" ? "zh-CN" : "en-US") : "";
  };
  // grid 模式 meta：日期 + 时长（不显示用户名——卡片聚焦内容，主播身份在详情页呈现）
  const metaText = () => [date(), fmtDuration(props.episode.durationSeconds)].filter(Boolean).join(" · ");
  // 封面 hover（grid 模式按钮划入的载体）；compact/list 不挂（避免多余事件）
  const coverPointerEnter = () => setHover(true);
  const coverPointerLeave = () => setHover(false);

  if (props.variant === "compact") {
    // 精简：只有封面图，不带交互
    return (
      <Cover
        episode={props.episode}
        sizes={CARD_COVER_SIZES}
        style={props.style}
        class={props.class}
      />
    );
  }

  if (props.variant === "list") {
    // 列表：封面 + 标题/日期 + （时长 + 播放按钮靠右）
    return (
      <div
        {...stylex.props(styles.listRow)}
        style={props.style}
        class={props.class}
        onClick={props.onClick}
        onPointerEnter={props.onHover}
      >
        <Cover
          episode={props.episode}
          sizes={CARD_COVER_SIZES}
          style={{ width: "56px", height: "56px" }}
        />
        <div {...stylex.props(styles.listInfo)}>
          <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
          <p {...stylex.props(styles.meta)}>{date()}</p>
        </div>
        <div {...stylex.props(styles.listRight)}>
          <span {...stylex.props(styles.duration)}>{fmtDuration(props.episode.durationSeconds)}</span>
          <PlayControls playing={props.playing} onPlay={props.onPlay} onPause={props.onPause} size="sm" />
        </div>
      </div>
    );
  }

  // grid 网格：封面（三态按钮 hover 划入）+ 标题 + 时间 + 时长，上下排列
  return (
    <div
      {...stylex.props(styles.gridCard)}
      style={props.style}
      class={props.class}
      onClick={props.onClick}
      onPointerEnter={props.onHover}
    >
      <div {...stylex.props(styles.coverSlot)} onPointerEnter={coverPointerEnter} onPointerLeave={coverPointerLeave}>
        <Cover episode={props.episode} sizes={CARD_COVER_SIZES} />
        <div {...stylex.props(styles.btnSlot)}>
          <PlayControls
            playing={props.playing}
            onPlay={props.onPlay}
            onPause={props.onPause}
            revealOnHover
            hovered={hover()}
          />
        </div>
      </div>
      <p {...stylex.props(styles.title)}>{props.episode.title || t("common.unnamed")}</p>
      <p {...stylex.props(styles.meta)}>
        <Show when={props.isNew}>
          <span {...stylex.props(styles.newDot)} />
        </Show>
        {metaText()}
      </p>
    </div>
  );
}


