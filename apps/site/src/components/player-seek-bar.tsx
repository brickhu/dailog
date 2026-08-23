// 播放进度条（播放条专用，SolidJS）：双层进度（缓冲层 + 播放层，带透明度叠加）+ 拖动 seek。
// 与通用 Slider（packages/ui）分离：缓冲层是音频播放器专属语义，不进通用组件（按需求单独实现）。
//
// 交互模型：拖动中「本地预览」——thumb/时间按指针位置走，不被外部 progress（timeupdate）回写；
// 松手（pointerup）时只回调一次 onSeek 真正提交，避免拖动中每次 seek 造成抖动/反复缓冲。
// 拖动允许越过已缓冲范围：松手后浏览器自动等待缓冲（audio waiting → buffering）。
// thumb 默认隐藏：桌面 hover 轨道 / 键盘聚焦 / 拖动中显示；移动端拖动时显示。
// 键盘（APG slider pattern）：方向键 ±5s、PageUp/Down ±30s、Home/End；键盘操作直接提交。
import * as stylex from "@stylexjs/stylex";
import { createSignal, splitProps, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, easings } from "@dailogues/ui/theme.stylex";

const TRACK_SIZE = 4;
const THUMB_SIZE = 20;
// 键盘步进（秒）
const KEY_STEP = 5;
const KEY_PAGE = KEY_STEP * 6;

export interface PlayerSeekBarProps {
  /** 当前播放位置（秒） */
  value: number;
  /** 已缓冲位置（秒）——缓冲层终点 */
  buffered: number;
  /** 总时长（秒）；<=0 视为未知（不渲染进度、不可交互） */
  duration: number;
  /** 拖动中预览回调（秒）；父级用它同步更新当前时间显示 */
  onPreview?: (sec: number) => void;
  /** 拖动/键盘操作结束时的提交回调（秒）——真正的 seek 在这里 */
  onSeek: (sec: number) => void;
  /** 禁用（音频错误等）；禁用时不可交互 */
  isDisabled?: boolean;
  /** aria 标签 */
  label?: string;
  /** 值格式化（aria-valuetext 用） */
  formatValue?: (sec: number) => string;
  /** StyleX 外部样式（覆盖内部同名属性） */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 内联样式（作用于根容器） */
  style?: string | JSX.CSSProperties;
}

const styles = stylex.create({
  // 主题色变量：与通用 Slider 同款（--slider-accent / --slider-track），消费方 xstyle 可覆盖
  accentVars: {
    "--slider-accent": colors.primary,
    "--slider-track": colors.primaryWeak,
  },
  root: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexGrow: 1,
    height: THUMB_SIZE,
    touchAction: "none",
    userSelect: "none",
    isolation: "isolate",
    cursor: "pointer",
    // thumb 揭示：桌面 hover 轨道（@media hover:hover 防触摸误触）与键盘聚焦（:focus-within）
    // 时经 CSS 变量下发 --seek-thumb-opacity=1（变量继承到 thumb），拖动中由 JS 叠加 thumbActive
    ":hover": {
      "@media (hover: hover)": {
        "--seek-thumb-opacity": "1",
      },
    },
    ":focus-within": {
      "--seek-thumb-opacity": "1",
    },
  },
  rootDisabled: {
    cursor: "not-allowed",
  },
  // 背景轨道（半透明弱色）
  track: {
    position: "absolute",
    insetInlineStart: 0,
    insetInlineEnd: 0,
    height: TRACK_SIZE,
    top: "50%",
    transform: "translateY(-50%)",
    borderRadius: dimensions.radiusFull,
    backgroundColor: "color-mix(in srgb, var(--slider-track) 60%, transparent)",
  },
  // 缓冲层（主色 35% 透明——与播放层叠加出两层透明度效果）
  buffered: {
    position: "absolute",
    insetInlineStart: 0,
    height: TRACK_SIZE,
    top: "50%",
    transform: "translateY(-50%)",
    borderRadius: dimensions.radiusFull,
    backgroundColor: "color-mix(in srgb, var(--slider-accent) 35%, transparent)",
  },
  // 播放层（主色实色，叠在缓冲层之上）
  played: {
    position: "absolute",
    insetInlineStart: 0,
    height: TRACK_SIZE,
    top: "50%",
    transform: "translateY(-50%)",
    borderRadius: dimensions.radiusFull,
    backgroundColor: "var(--slider-accent)",
  },
  // 拖动圆点：默认透明度 0（不可见）；root :hover/:focus-within 置 --seek-thumb-opacity=1 揭示
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "var(--slider-accent)",
    top: "50%",
    transform: "translate(-50%, -50%)",
    opacity: "var(--seek-thumb-opacity, 0)",
    transitionProperty: "opacity",
    transitionDuration: durations.durationFast,
    transitionTimingFunction: easings.easeInOut,
    zIndex: 1,
    pointerEvents: "none", // 拖动/点击走根容器 pointer 事件，thumb 不拦截
  },
  // 拖动中常显（JS 侧叠加：元素自身置变量，覆盖 root 继承值）
  thumbActive: {
    "--seek-thumb-opacity": "1",
  },
});

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerSeekBar(props: PlayerSeekBarProps) {
  const [local, rest] = splitProps(props, [
    "value",
    "buffered",
    "duration",
    "onPreview",
    "onSeek",
    "isDisabled",
    "label",
    "formatValue",
    "xstyle",
    "class",
    "style",
  ]);
  // 拖动中的本地预览值；null = 未拖动（显示外部 value）
  const [dragSec, setDragSec] = createSignal<number | null>(null);
  let rootEl: HTMLDivElement | null = null;

  const isDisabled = () => local.isDisabled ?? false;
  const duration = () => Math.max(0, local.duration || 0);
  const known = () => duration() > 0;
  const shownValue = () => dragSec() ?? local.value;
  const percent = (sec: number): number =>
    known() ? clamp((sec || 0) / duration(), 0, 1) * 100 : 0;

  const valueFromPointer = (clientX: number): number => {
    const el = rootEl;
    if (!el || !known()) return 0;
    const rect = el.getBoundingClientRect();
    let pct = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    // RTL：值=min 在右侧，按轨道 computed direction 从右测量（与通用 Slider 一致）
    const dir =
      typeof getComputedStyle === "function"
        ? getComputedStyle(el).direction
        : "ltr";
    if (dir === "rtl") pct = 1 - pct;
    pct = clamp(pct, 0, 1);
    return clamp(Math.round(pct * duration() * 10) / 10, 0, duration());
  };

  // ---- pointer ----
  const beginDrag = (e: PointerEvent) => {
    if (isDisabled() || !known()) return;
    e.preventDefault();
    const v = valueFromPointer(e.clientX);
    setDragSec(v);
    local.onPreview?.(v);
    if (typeof (e.currentTarget as HTMLDivElement).setPointerCapture === "function") {
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    }
  };
  const moveDrag = (e: PointerEvent) => {
    if (dragSec() === null || isDisabled() || !known()) return;
    const v = valueFromPointer(e.clientX);
    setDragSec(v);
    local.onPreview?.(v);
  };
  const endDrag = () => {
    const v = dragSec();
    if (v === null) return;
    setDragSec(null);
    local.onSeek(v);
  };

  // ---- keyboard（APG slider pattern；键盘操作无中间态，直接提交）----
  const onKeyDown = (e: KeyboardEvent) => {
    if (isDisabled() || !known()) return;
    const cur = shownValue();
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = cur + KEY_STEP;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = cur - KEY_STEP;
        break;
      case "PageUp":
        next = cur + KEY_PAGE;
        break;
      case "PageDown":
        next = cur - KEY_PAGE;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = duration();
        break;
      default:
        return;
    }
    e.preventDefault();
    local.onSeek(clamp(next, 0, duration()));
  };

  const rootAttrs = () => {
    const attrs = stylex.props(
      styles.accentVars,
      styles.root,
      isDisabled() && styles.rootDisabled,
      local.xstyle,
    );
    const external = local.class;
    if (external == null) {
      return { ...attrs, ...rest };
    }
    const className = attrs.className
      ? `${attrs.className} ${external}`
      : external;
    return { ...attrs, className, ...rest };
  };

  return (
    <div
      ref={(el) => {
        rootEl = el;
      }}
      role="slider"
      tabIndex={isDisabled() ? -1 : 0}
      aria-label={local.label ?? "seek"}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration())}
      aria-valuenow={Math.round(shownValue())}
      aria-valuetext={
        local.formatValue
          ? local.formatValue(shownValue())
          : fmt(shownValue())
      }
      aria-disabled={isDisabled() || undefined}
      onPointerDown={beginDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      {...rootAttrs()}
      style={local.style}
    >
      {/* 背景轨道 */}
      <div aria-hidden="true" {...stylex.props(styles.track)} />
      {/* 缓冲层（叠在播放层下；宽度不足播放层时被播放层盖住） */}
      <div
        aria-hidden="true"
        {...stylex.props(styles.buffered)}
        style={{ width: `${percent(local.buffered)}%` }}
      />
      {/* 播放层（实色，叠在缓冲层上） */}
      <div
        aria-hidden="true"
        {...stylex.props(styles.played)}
        style={{ width: `${percent(shownValue())}%` }}
      />
      {/* 拖动圆点：默认隐藏，hover/聚焦/拖动中显示 */}
      <div
        aria-hidden="true"
        {...stylex.props(styles.thumb, dragSec() !== null && styles.thumbActive)}
        style={{ "inset-inline-start": `${percent(shownValue())}%` }}
      />
    </div>
  );
}

PlayerSeekBar.displayName = "PlayerSeekBar";