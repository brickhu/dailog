// 全局播放条（贯通全站）：底部常驻——封面缩略 + 标题 + 上一期/播放/暂停/下一期 + 进度条（可拖动）。
// 数据来自 PlaybackContext（队列/连播/统计上报/预加载均在此层）；点标题进详情页。
// 出现方式：DOM 全程常驻（不卸载），未激活（尚未开始播放）时 visibility:hidden +
// translateY 平移到页面最底部之外；用户触发播放（play/toggle）后滑入底部——纯 CSS
// transition 实现，避免 display:none 式条件渲染造成的突兀出现。
import { Show, onCleanup, onMount } from "solid-js";
import { A } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, typography, shadows, easings } from "@dailogues/ui/theme.stylex";
import { episodeCoverUrl } from "../lib/env";
import { usePlayback } from "../lib/playback";
import { Icon,Button,Slider } from "@dailogues/ui";

// 断点标签（与 theme.stylex.ts 的 DESKTOP 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (min-width: 1025px)";

const styles = stylex.create({
  // 未激活（尚未开始播放）：DOM 常驻不卸载，但 visibility:hidden 且沿 Y 轴平移到
  // 页面最底部之外（translateY 100% + 底部偏移）——不可见、不占交互；用户触发播放后
  // 叠加 barVisible，由 transform transition 从底部滑入，替代原先 Show 条件渲染的突兀出现。
  // 底部安全区（iOS 刘海/Home Indicator）：env() 不可用时回退 0（桌面/WebView 不受影响）。
  // 关键：不要在 calc() 里直接嵌套 env()（webkit bug 190771：safe-area env 值并非始终可用，
  // 嵌套失效会让整个 calc() 无效 → bottom 被丢弃 → bottom:auto → fixed 元素回落到页面顶部）。
  // 统一经 app.css 的 --dailog-safe-bottom 中转 + var() fallback 兜底。
  bar: {
    position: "fixed",
    borderColor: colors.surfaceStrong,
    borderStyle: "solid",
    borderWidth: `1px 1px 1px 1px`,
    left: dimensions.spacing3,
    right: dimensions.spacing3,
    bottom: `calc(${dimensions.spacing3} + var(--dailog-safe-bottom, 0px))`,
    borderRadius: dimensions.radiusLg,
    padding: `${dimensions.spacing3} ${dimensions.spacing3}`,
    flexWrap: "wrap",
    // 隐藏态：不可见 + 移出视口；过渡同时声明 transform（滑入/滑出）与 visibility
    // （visible 立即可见；hidden 延迟到 400ms 滑出结束后再隐藏，保证退出动画可见）。
    // 注意：transform 不在 [DESKTOP] 里覆盖——stylex 的 media query 会编译成双类选择器
    // （.x.y.x.y）提高特异性，会压过激活态 barVisible 的 translateY(0)，导致激活后播放条
    // 仍留在视口外。统一用 base 的 100%+偏移（桌面 bottom:0 时 100% 同样完全出视口）
    visibility: "hidden",
    transform: `translateY(calc(100% + ${dimensions.spacing3} + var(--dailog-safe-bottom, 0px)))`,
    transition: `transform 400ms ${easings.easeOut}, visibility 0s linear 400ms`,
    pointerEvents: "none",
    [DESKTOP]: {
      left: "0",
      right: "0",
      bottom: "0",
      borderRadius: dimensions.radius0,
      borderWidth: `1px 0px 0px 0px`,
      padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
      gap: dimensions.spacing8,
      flexWrap: "nowrap"
    },
    "@media (prefers-reduced-motion: reduce)": {
      transition: "none"
    },
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    backgroundImage: `linear-gradient(to bottom,  color-mix(in srgb, ${colors.surfaceWeak} 80%, transparent) 0%, ${colors.surfaceWeak} 100%)`,
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    color: colors.onSurfaceWeak,
    filter: `drop-shadow(${shadows.shadowLow})`
  },
  // 激活态（已开始播放）：从页面底部滑入（transform 100% → 0）；visibility 立即转为可见
  barVisible: {
    visibility: "visible",
    transform: "translateY(0)",
    transition: `transform 400ms ${easings.easeOut}, visibility 0s`,
    pointerEvents: "auto",
    "@media (prefers-reduced-motion: reduce)": {
      transition: "none"
    }
  },
  cover: {
    width: dimensions.sizeLg,
    height: dimensions.sizeLg,
    objectFit: "cover",
    flexShrink: 0,
    display: "flex",
    borderRadius: dimensions.radiusSm,
    boxSizing : "border-box",
    borderColor : colors.surfaceStrong,
    borderWidth : "1px",
    borderStyle : "solid",
    backgroundColor : colors.surfaceWeak,
    justifyContent: "center",
    alignItems: "center",
    color: colors.onSurfaceWeak,
    ":visited": { color: colors.onSurfaceWeak },
  },
  audioErrorIcon: {
    color: colors.onSurface,
    ":visited": { color: colors.onSurface },
  },
  info: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing4,
    maxWidth: "50%",
    order: 1,

  },
  title: {
    // display: "none",
    textOverflow: "ellipsis",
    overflow: "hidden",
    flex:1,
    whiteSpace: "nowrap" ,
    textDecoration: "none",
    color: colors.onSurface,
    [DESKTOP]: {
      display : "block",
      // color: `color-mix(in sgba, currentColor 50%, transparent)`
    }

  },
  btn: {
    [DESKTOP]: {
      width: dimensions.sizeLg
    }
  },
  btns: {
    display: "flex",
    gap: dimensions.spacing2,
    minWidth: `calc(${dimensions.spacing12} *3 )`,
    justifyContent : "end",
    order: 2,
    [DESKTOP]:{
      order: 3,
    }
  },
  progress: {
    display : "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    order: 3,
    gap: dimensions.spacing4,
    flex: 1,
    [DESKTOP]: {
      order: 2
    }
  },
  time: {
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
    opacity: "0.5"
  },
  slider: {
    flex: 1,
    maxWidth: "360px",
    minWidth: "36px"
  }
});

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}



export function PlayerBar() {
  const pb = usePlayback();
  const ep = () => pb.current();

  // 键盘快捷键（仅播放条激活、有当前节目时生效）：
  //   Space / F8        → 播放/暂停
  //   F7 / →(ArrowRight) → 下一期
  //   F9 / ←(ArrowLeft)  → 上一期
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pb.activated() || !pb.current()) return; // 播放条未激活 → 不劫持
      // 带修饰键（Cmd/Ctrl/Option/Shift）的按键交给系统/浏览器（如 Cmd+Space、Cmd+←）
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.repeat) return; // 长按不连发，避免误跳多期/反复切换
      if (e.isComposing || e.keyCode === 229) return; // IME 组合态（空格选字）不触发
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      // 输入控件/可编辑区：交给自身处理
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      // 按钮/进度条滑块聚焦时：Space/方向键由控件原生处理（避免双重触发）
      if (el?.closest?.("button, [role='slider']")) return;

      switch (e.key) {
        case " ": // Space
        case "F8":
          e.preventDefault();
          pb.toggle();
          break;
        case "ArrowRight":
        case "F7":
          e.preventDefault();
          pb.next();
          break;
        case "ArrowLeft":
        case "F9":
          e.preventDefault();
          pb.prev();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    // 播放条 DOM 常驻：未激活时叠加隐藏态（visibility:hidden + translateY 移出视口），
    // 激活后叠加 barVisible 由底部滑入——不再用 Show 卸载导致突兀出现
    <div
      {...stylex.props(styles.bar, pb.activated() && ep() ? styles.barVisible : undefined)}
    >
      {/* 内容依赖当前节目：无节目时不渲染内部内容，但 bar 容器常驻（隐藏态） */}
      <Show when={ep()}>
        <div {...stylex.props(styles.info)}>
          <A href={`/episode/${ep()!.slug}`}>
          <Show when={episodeCoverUrl(ep()!.id, ep()!.coverUrl)} fallback={<div {...stylex.props(styles.cover)}><Icon icon="iconoir:warning-triangle" width={16} {...stylex.props(styles.audioErrorIcon)}/></div>}>
            {/* 播放条封面 ~48px：直接请求 160 缩略规格，不拉原图 */}
            <img src={episodeCoverUrl(ep()!.id, ep()!.coverUrl, 160)!} alt="" {...stylex.props(styles.cover)} />
          </Show>
        </A>
          <A href={`/episode/${ep()!.slug}`} {...stylex.props(styles.title, typography.caption)}>{ep()!.title || ""}</A>
        </div>
        <div {...stylex.props(styles.progress)}>
          <span {...stylex.props(styles.time,typography.caption)}>{fmt(pb.progress())}</span>
          <Slider 
            label="audio process" 
            value={Math.min(pb.progress(), pb.duration() || 0)}
            onChange={(v) => pb.seek(Number(v))}
            isDisabled={pb.buffering() || pb.audioError()}
            step={0.5}
            min={0}
            xstyle={styles.slider}
            valueDisplay="none"
            isLabelHidden
          />
          <span {...stylex.props(styles.time, typography.caption)}>{fmt(pb.duration())}</span>
        </div>
  
        <div {...stylex.props(styles.btns)}>
          <Button
            {...stylex.props(styles.btn)}
            appear="ghost"
            onClick={pb.prev}
            aria-label="prev"
            icon={<Icon icon="iconoir:skip-prev" />}
            isDisabled={pb.queue().length <= 1} // 队列只有一期 → 没有可回的上一期
            isIconOnly
            round="full"
            size="lg"
          />

          {/* 缓冲/加载中（切换节目加载、播放中网络卡顿）→ isLoading：spinner 覆盖图标 + 自动禁用；
              加载结束恢复播放/暂停图标。audioError 时仍显式禁用（警告态不可点）。
              优先级与 PlayButton 对齐：playing 优先于 buffering——切歌加载时（playing=false）
              两处都转 spinner；播放中网络卡顿（playing=true 且 buffering=true）两处都显示暂停，
              保证卡片播放按钮与播放条永远同态（否则加载期按钮显示暂停、播放条还在转 spinner） */}
          <Button
            {...stylex.props(styles.btn)}
            onClick={pb.toggle}
            aria-label={pb.playing() ? "pause" : "play"}
            icon={pb.playing() ? <Icon icon="iconoir:pause-solid" /> : <Icon icon="iconoir:play-solid" />}
            isLoading={pb.buffering() && !pb.playing()}
            isDisabled={pb.audioError()}
            isIconOnly
            round="full"
            size="lg"
          />

          <Button
            {...stylex.props(styles.btn)}
            appear="ghost"
            onClick={pb.next} 
            aria-label="next"
            icon={<Icon icon="iconoir:skip-next" />}
            isIconOnly
            round="full"
            size="lg"
          />
        </div>  
        {/* <button
          {...stylex.props(styles.btn, styles.btnMain)}
          onClick={pb.toggle}
          aria-label={pb.playing() ? "pause" : "play"}
        >
          {pb.playing() ? <Icon icon="iconoir:pause-solid" /> : <Icon icon="iconoir:play-solid" />}
        </button>
        <button {...stylex.props(styles.btn)} onClick={pb.next} aria-label="next">
          <Icon icon="iconoir:skip-next" />
        </button> */}
        </Show>
    </div>
  );
}
