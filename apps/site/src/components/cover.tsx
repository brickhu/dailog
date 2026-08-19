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
    color: `color-mix(in srgb, ${colors.onSuccessStrong} 10%, transparent)`,
    pointerEvents: "none",
  },
});

const BrandPattern = () =>{
  return(
     <svg width="160" height="160" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M153.26 110.576C140.872 137.323 112.733 156 80 156C47.2669 156 19.1264 137.324 6.73926 110.576C20.238 132.774 47.9742 148 80 148C112.026 148 139.761 132.774 153.26 110.576Z" fill="currentColor"/>
              <path d="M134.885 113.656C122.512 127.809 102.537 137 80 137C57.4631 137 37.4872 127.81 25.1143 113.656C38.321 124.879 58.0089 132 80 132C101.991 132 121.678 124.879 134.885 113.656Z" fill="currentColor"/>
              <path d="M114.59 109.116C105.857 117.057 93.589 122 80 122C66.4108 122 54.1419 117.057 45.4092 109.116C54.6001 115.262 66.7175 119 80 119C93.2821 119 105.399 115.262 114.59 109.116Z" fill="currentColor"/>
              <path d="M80 38C93.5887 38 105.857 42.9423 114.59 50.8828C105.399 44.7372 93.2819 41 80 41C66.7178 41 54.6 44.737 45.4092 50.8828C54.1418 42.942 66.411 38 80 38Z" fill="currentColor"/>
              <path d="M80 4C112.733 4 140.872 22.6761 153.26 49.4229C139.761 27.2255 112.025 12 80 12C47.9746 12 20.2381 27.2252 6.73926 49.4229C19.1266 22.6759 47.2672 4 80 4Z" fill="currentColor"/>
              <path d="M80 23C102.536 23 122.512 32.19 134.885 46.3428C121.678 35.1205 101.99 28 80 28C58.0092 28 38.321 35.1202 25.1143 46.3428C37.4872 32.1897 57.4634 23 80 23Z" fill="currentColor"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M69.7344 56.0002C75.5926 56.0002 80.5953 60.2302 81.5684 66.0071L87.9668 104H79.8545L77.1592 88.0002H58.792L56.0684 104H47.9531L54.4238 65.9866C55.4056 60.2194 60.4028 56.0005 66.2529 56.0002H69.7344ZM66.2529 64.0002C64.303 64.0005 62.6378 65.4071 62.3105 67.3293L60.1533 80.0002H75.8115L73.6787 67.3362C73.3543 65.4106 71.6871 64.0002 69.7344 64.0002H66.2529Z" fill="currentColor"/>
              <path d="M112.258 104H104.143L96 56.0002H104.113L112.258 104Z" fill="currentColor"/>
            </svg>
  )
}

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
        fallback={<div {...stylex.props(styles.placeholder)}><BrandPattern/></div>}
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
          <div {...stylex.props(styles.placeholder)}>
            <BrandPattern/>

          </div>
        </Show>
      </Show>
    </div>
  );
}
