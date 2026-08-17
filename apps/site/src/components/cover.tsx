// 封面图（统一封面组件）：只负责显示图片，无交互/无按钮。
// - LQIP 渐进：先加载最小尺寸（160w）高斯模糊铺底，大图（srcset/sizes 响应式）就绪后
//   淡入变清晰——首帧不空白，慢网也有模糊预览
// - 大图就绪判定不依赖 onLoad 事件（hydration 时序下图片可能先于事件绑定完成加载，
//   onLoad 丢失会卡在模糊态）：onMount 用 img.complete 同步检查（缓存/已加载直接清晰）
// - 无圆角 + inset 描边（前景色 20% 透明，画在盒子内不占布局）
// - 三态播放按钮（play/loading/pause，hover 划入）在 episode-card（PlayControls，
//   grid 封面划入 / list 右侧）与详情页封面（PlayControls 覆盖右下角）——按钮归卡片层
import { Show, createSignal, onMount, type JSX } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors } from "@dailogues/ui/theme.stylex";
import { DETAIL_COVER_SIZES, episodeCoverSrcset, episodeCoverUrl } from "../lib/env";
import type { QueueEpisode } from "../lib/playback";

/** LQIP 占位尺寸（?w= 白名单最小档）：模糊底图足够轻，只提供"有内容"的预览 */
const LQIP_WIDTH = 160;

const styles = stylex.create({
  wrap: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    overflow: "hidden",
    backgroundColor: colors.surface,
    userSelect: "none",
    flexShrink: 0,
    // 默认描边：前景色 20% 透明；inset 画在盒子内部（不占布局、不随内容裁切）
    // currentColor 跟随页面前景色（浅/暗色主题自动适配）
    boxShadow: "inset 0 0 0 1px color-mix(in srgb, currentColor 20%, transparent)",
  },
  // LQIP 底图：最小尺寸 + 高斯模糊；放大防模糊边缘露出背景色
  blurImg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: "blur(24px)",
    transform: "scale(1.15)",
  },
  img: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
    // 大图未就绪：透明（模糊底图垫底）；就绪后淡入变清晰
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "0.35s",
    transitionTimingFunction: "ease",
  },
  imgLoaded: {
    opacity: 1,
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
});

export function Cover(props: {
  /** 节目 meta（id / coverUrl / title） */
  episode: QueueEpisode;
  /** 封面 sizes（响应式选图）；缺省详情页档 */
  sizes?: string;
  /** CSS 控制显示大小（透传；默认 width 100% 由父级控制） */
  style?: JSX.CSSProperties;
  class?: string;
}) {
  const [imgError, setImgError] = createSignal(false);
  // 大图是否就绪（模糊 → 清晰切换）
  const [loaded, setLoaded] = createSignal(false);
  let imgRef: HTMLImageElement | undefined;

  // 不依赖 onLoad 事件（hydration 时序下可能丢失）：挂载时同步检查 complete——
  // 已加载（缓存/SSR 期间请求完成）直接清晰；未加载靠 onLoad 事件补
  onMount(() => {
    if (imgRef?.complete && imgRef.naturalWidth > 0) setLoaded(true);
  });

  return (
    <div {...stylex.props(styles.wrap)} style={props.style} class={props.class}>
      <Show
        when={episodeCoverUrl(props.episode.id, props.episode.coverUrl)}
        fallback={<div {...stylex.props(styles.placeholder)}>🎙</div>}
      >
        {/* LQIP 底图：最小尺寸 + 高斯模糊（装饰层，读屏忽略） */}
        <img
          src={episodeCoverUrl(props.episode.id, props.episode.coverUrl, LQIP_WIDTH)!}
          alt=""
          aria-hidden="true"
          {...stylex.props(styles.blurImg)}
        />
        {/* 大图：响应式 srcset/sizes；就绪后淡入覆盖模糊层；失败时 🎙 占位覆盖 */}
        <img
          ref={imgRef}
          src={episodeCoverUrl(props.episode.id, props.episode.coverUrl, 960)!}
          srcset={episodeCoverSrcset(props.episode.id, props.episode.coverUrl) ?? undefined}
          sizes={props.sizes ?? DETAIL_COVER_SIZES}
          alt={props.episode.title || ""}
          onError={() => setImgError(true)}
          onLoad={() => setLoaded(true)}
          {...stylex.props(styles.img, loaded() && styles.imgLoaded)}
        />
        <Show when={imgError()}>
          <div {...stylex.props(styles.placeholder)}>🎙</div>
        </Show>
      </Show>
    </div>
  );
}
