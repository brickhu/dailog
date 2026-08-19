// Carousel（复刻 Astryx Carousel：https://astryx.atmeta.com/components/Carousel，
// 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
// - 原生横向滚动容器（overflow-x: auto）：触摸拖动 / 触控板横扫天然支持；
//   Shift + 滚轮（鼠标）映射为横向滚动——三者都不拦截，页面纵向滚动不受影响
// - 溢出时两侧浮现渐变遮罩（scroller 的 mask-image，hasEdgeFade）+ 翻页按钮
//   （hasButtons，绝对定位浮层，垂直居中跨骑边缘）
// - hasLoop 循环滚动：内容溢出时末尾 Next 回到起点、起点 Prev 跳到末尾，按钮两端常驻
// - hasSnap 滚动吸附：容器 scroll-snap-type: x mandatory，每项 scroll-snap-align: start
// - handleRef 命令式句柄：scrollNext/scrollPrev/scrollTo(index)/canScrollNext/canScrollPrev
//   （与按钮同走原生滚动机制，尊重 reduced-motion 与 hasLoop）
// - APG carousel 语义：根 region + aria-roledescription="carousel"，每项 group +
//   aria-roledescription="slide" + "Slide N of M" 可访问名
// - 1px 视觉 bleed：scroller paddingBottom 1px + marginBottom -1px（子项选中指示器不被裁切）
// - 变量全部使用 theme.stylex 非废弃 tokens（colors/dimensions/durations/easings）
import {
  children as memoChildren,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  splitProps,
  For,
  type JSX,
} from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, easings } from "../theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Button } from "./button";
import { Icon } from "./icon";

/**
 * Carousel 命令式控制句柄（经 handleRef 获取）。方法驱动与内置按钮相同的原生滚动
 * 机制，因此尊重 hasLoop、prefers-reduced-motion 与 RTL。
 */
export interface CarouselHandle {
  /** 向前滚动约一个视口；hasLoop 时到达末尾回到起点 */
  scrollNext(): void;
  /** 向后滚动约一个视口；hasLoop 时到达起点跳到末尾 */
  scrollPrev(): void;
  /** 把第 index（0 起）项滚到起始边缘；index 越界自动夹紧，只滚动自身不动页面 */
  scrollTo(index: number): void;
  /** 末尾方向是否还有可滚动内容；hasLoop 时只要有溢出恒为 true（实时读取） */
  canScrollNext(): boolean;
  /** 起始方向是否还有可滚动内容；hasLoop 时只要有溢出恒为 true（实时读取） */
  canScrollPrev(): boolean;
}

/** 项间距档位（对应 theme.stylex spacingN；0.5/1.5 为 2px/6px，token 无此档位） */
export type CarouselGap = 0 | 0.5 | 1 | 1.5 | 2 | 3 | 4;
/** 滚动容器内边距档位（对应 theme.stylex spacingN；0.5/1.5 为 2px/6px） */
export type CarouselPadding = 0 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6 | 8 | 10;

/** handleRef：Solid 回调或 { current } 对象（React Ref 对象兼容形态） */
export type CarouselHandleRef =
  | ((handle: CarouselHandle | null) => void)
  | { current?: CarouselHandle | null };

export interface CarouselProps
  extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref" | "style"> {
  /** 轮播项：渲染在横向滚动容器内的一行 */
  children: JSX.Element;
  /** 项间距（spacing 档位：1 = 4px，2 = 8px，3 = 12px…）@default 1 */
  gap?: CarouselGap;
  /** 内容可滚动时显示上一页/下一页按钮 @default true */
  hasButtons?: boolean;
  /** 溢出时显示边缘渐变遮罩（指示还有更多内容）@default true */
  hasEdgeFade?: boolean;
  /**
   * 循环滚动：内容溢出时，末尾按 Next 回到起点、起点按 Prev 跳到末尾（按钮与
   * handleRef 一致）；按钮两端常驻而非隐藏。内容不溢出时无效果。@default false
   */
  hasLoop?: boolean;
  /** 滚动吸附：每项吸附到起始边缘 @default false */
  hasSnap?: boolean;
  /** 滚动容器内边距（padding-inline + 匹配的 scroll-padding，吸附点对齐内容边缘） */
  padding?: CarouselPadding;
  /** 轮播区域的可访问名称 @default t("carousel.label") */
  "aria-label"?: string;
  /** 命令式句柄：scrollNext/scrollPrev/scrollTo/canScrollNext/canScrollPrev */
  handleRef?: CarouselHandleRef;
  /** 根元素引用（Solid：函数回调） */
  ref?: ((el: HTMLDivElement) => void) | undefined;
  /** StyleX 样式：外部注入覆盖（stylex.create 产物，最后合并） */
  xstyle?: StyleXStyles;
  /**
   * 每项包裹层的 StyleX 样式。项宽度默认由内容决定（flexShrink: 0 不收缩）；
   * 要「每屏 N 条恰好贴边」，用百分比宽：N 条时 width: calc(100%/N - (N-1)*gap/N)，
   * 百分比相对滚动容器实际宽度解析（精确跟随容器，不受滚动条/box-sizing 影响）
   */
  itemXstyle?: StyleXStyles;
  /** 内联样式（根元素） */
  style?: JSX.CSSProperties;
  /** 外部 class（与内部 stylex 类名拼接） */
  class?: string;
  className?: string;
  "data-testid"?: string;
}

const styles = stylex.create({
  // 根：相对定位（按钮浮层锚点）；不设 overflow: clip——Astryx 用 Layer 让跨骑边缘的
  // 按钮逃出裁剪，本站无 Layer 系统，靠不裁剪根节点让按钮完整显示（滚动内容由
  // scroller 自身 overflowX: auto 裁剪，遮罩是 scroller 上的 mask-image）
  root: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    minWidth: 0,
    maxWidth: "100%",
  },
  scroller: {
    display: "flex",
    alignItems: "center",
    // width: 100% 让 scroller 宽度 definite（相对 root，root 是 grid item 宽度确定）——
    // 否则作为 root 的 flex item（width auto）宽度由内容决定（indefinite），子项（项包裹层）
    // 的百分比宽度会解析为 auto → 各卡片塌缩成内容宽度（无封面卡片特别小）
    width: "100%",
    overflowX: "auto",
    overflowY: "hidden",
    // 1px bleed：底部裁切余量（子项选中指示器不贴边），配合 marginBottom 抵消
    paddingBottom: "1px",
    marginBottom: "-1px",
    overscrollBehaviorX: "contain",
    scrollBehavior: {
      default: "smooth",
      "@media (prefers-reduced-motion: reduce)": "auto",
    },
    scrollbarWidth: "none",
    maskImage: "none",
    transitionProperty: "mask-image",
    transitionDuration: {
      default: durations.durationMediumMin,
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
    transitionTimingFunction: easings.easeInOut,
    // 键盘可聚焦：Tab 聚焦后 ←/→ 键原生滚动
    outline: { default: null, ":focus-visible": `2px solid ${colors.primary}` },
    outlineOffset: { default: "0", ":focus-visible": "2px" },
  },
  // 边缘渐变遮罩（mask-image：内容本身被淡化，适配任意底色；随溢出状态切换过渡）
  fadeStart: {
    // backgroundColor: "red",
    maskImage: "linear-gradient(to right, transparent 0%,  black 16px)",
  },
  fadeEnd: {
    // backgroundColor: "red",
    maskImage: "linear-gradient(to left, transparent 0%, black 16px)",
  },
  fadeBoth: {
    // backgroundColor: "red",
    maskImage:
      "linear-gradient(to right, transparent 0%, black 16px, black calc(100% - 16px),  transparent 100%)",
  },
  snap: {
    scrollSnapType: "x mandatory",
  },
  // 每项：flex item（不收缩）+ 吸附对齐；宽度由内容决定（消费方给子项定宽）
  item: {
    scrollSnapAlign: "start",
    display: "flex",
    flexShrink: 0,
  },
  // 按钮浮层：绝对定位盖住整个轮播区，两端各一个圆形胶囊按钮（垂直居中跨骑边缘）
  buttonOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    pointerEvents: "none",
    zIndex: 1,
  },
  buttonPill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.popover,
    borderRadius: dimensions.radiusFull,
    // 无阴影：深色胶囊压在浅色背景上，boxShadow 会在按钮下缘形成一条 1px 细框暗带
    pointerEvents: "auto",
    opacity: 1,
    transitionProperty: "opacity",
    transitionDuration: durations.durationFast,
    transitionTimingFunction: easings.easeInOut,
  },
  buttonPillStart: {
    transform: "translateX(-50%)",
  },
  buttonPillEnd: {
    transform: "translateX(50%)",
  },
  buttonHidden: {
    opacity: 0,
    pointerEvents: "none",
  },
});

// gap 档位 → px（0.5/1.5 无 token，内联 2px/6px；其余引用 spacing tokens）
const GAP_PX: Record<CarouselGap, string> = {
  0: dimensions.spacing0,
  0.5: "2px",
  1: dimensions.spacing1,
  1.5: "6px",
  2: dimensions.spacing2,
  3: dimensions.spacing3,
  4: dimensions.spacing4,
};

const PAD_PX: Record<CarouselPadding, string> = {
  0: dimensions.spacing0,
  0.5: "2px",
  1: dimensions.spacing1,
  1.5: "6px",
  2: dimensions.spacing2,
  3: dimensions.spacing3,
  4: dimensions.spacing4,
  5: dimensions.spacing5,
  6: dimensions.spacing6,
  8: dimensions.spacing8,
  10: dimensions.spacing10,
};

const SPLIT_KEYS = [
  "children", "gap", "hasButtons", "hasEdgeFade", "hasLoop", "hasSnap", "padding",
  "aria-label", "handleRef", "ref", "xstyle", "itemXstyle", "style", "class", "className", "data-testid",
] as const;

/**
 * 横向滚动容器轮播（两站共享）：溢出时渐变遮罩 + 翻页按钮；hasLoop 循环、
 * hasSnap 吸附、handleRef 命令式控制。触摸拖动 / 触控板横扫 / Shift+滚轮原生支持。
 *
 * @example
 * <Carousel gap={2} aria-label="推荐节目">
 *   <div style={{ width: 200 }}>…</div>
 *   <div style={{ width: 200 }}>…</div>
 * </Carousel>
 */
export function Carousel(props: CarouselProps) {
  const { t } = useI18n();
  const [local, rest] = splitProps(props, SPLIT_KEYS);

  const gap = local.gap ?? 1;
  const hasButtons = local.hasButtons ?? true;
  const hasEdgeFade = local.hasEdgeFade ?? true;
  const hasLoop = !!local.hasLoop;
  const ariaLabel = local["aria-label"] ?? t("carousel.label");

  // 子项（过滤 null/undefined/boolean 并展平，与 React Children.toArray 语义一致）
  const memoized = memoChildren(() => local.children);
  const items = () => memoized.toArray();

  let scrollerEl: HTMLDivElement | undefined;
  // 溢出状态（scroll/resize/子项变化实时刷新；hasLoop 时按钮两端常驻用）
  const [overflowStart, setOverflowStart] = createSignal(false);
  const [overflowEnd, setOverflowEnd] = createSignal(false);
  const [hasOverflow, setHasOverflow] = createSignal(false);
  // 滚动性能：direction 与 scrollWidth/clientWidth 缓存——scroll 事件路径只读 scrollLeft，
  // 避免每帧 getComputedStyle/布局读取（强制 style/layout flush 是滚动卡顿的主因）；
  // 尺寸只在 resize/子项变化时经 measure() 刷新，scroll 事件 rAF 合并到每帧一次
  let isRtl = false;
  let scrollW = 0;
  let clientW = 0;
  let scrollRaf = 0;

  const measure = () => {
    const el = scrollerEl;
    if (!el) return;
    scrollW = el.scrollWidth;
    clientW = el.clientWidth;
  };

  const updateOverflow = () => {
    const el = scrollerEl;
    if (!el) return;
    const sw = scrollW;
    const cw = clientW;
    const overflow = sw > cw + 1; // 1px 容差（避免亚像素误判）
    setHasOverflow(overflow);
    if (!overflow) {
      setOverflowStart(false);
      setOverflowEnd(false);
      return;
    }
    const sl = el.scrollLeft;
    if (isRtl) {
      // RTL：scrollLeft 为负（start 在右侧，0 = 起点）
      setOverflowStart(sl < -1);
      setOverflowEnd(sl > -(sw - cw) + 1);
    } else {
      setOverflowStart(sl > 1);
      setOverflowEnd(sl < sw - cw - 1);
    }
  };

  onMount(() => {
    const el = scrollerEl;
    if (!el) return;
    isRtl = getComputedStyle(el).direction === "rtl"; // 一次性缓存（滚动路径不再查询）
    measure();
    updateOverflow();
    // scroll 高频事件 rAF 合并：每帧至多一次溢出刷新（滚动中按钮/遮罩状态跟随）
    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        updateOverflow();
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      measure();
      updateOverflow();
    });
    ro.observe(el);
    onCleanup(() => {
      el.removeEventListener("scroll", onScroll);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      ro.disconnect();
    });
  });

  // 子项变化（数量/宽度）后重测溢出：Solid 渲染同步提交，DOM 更新完即可测量
  createEffect(() => {
    items();
    measure();
    updateOverflow();
  });

  const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  // 按逻辑方向滚动约一个视口（clientWidth - 半项宽，至少一项宽）：
  // hasLoop 且到边缘 → 反向整幅滚动（浏览器自动夹紧到另一边缘 = 环绕）
  const scrollByDir = (direction: -1 | 1) => {
    const el = scrollerEl;
    if (!el) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const rtlSign = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    if (hasLoop && hasOverflow()) {
      const atEnd = direction === 1 && !overflowEnd();
      const atStart = direction === -1 && !overflowStart();
      if (atEnd || atStart) {
        el.scrollBy({ left: rtlSign * -direction * el.scrollWidth, behavior });
        return;
      }
    }
    const firstChild = el.firstElementChild as HTMLElement | null;
    const itemWidth = firstChild ? firstChild.offsetWidth : 0;
    const amount = el.clientWidth - itemWidth * 0.5;
    el.scrollBy({ left: rtlSign * direction * Math.max(amount, itemWidth), behavior });
  };

  // 第 index 项滚到起始边缘（scrollBy 差值而非 scrollIntoView：只滚自身、不动页面）
  const scrollToIndex = (index: number) => {
    const el = scrollerEl;
    if (!el) return;
    const itemsEls = el.children;
    if (itemsEls.length === 0) return;
    const clamped = Math.max(0, Math.min(index, itemsEls.length - 1));
    const target = itemsEls[clamped] as HTMLElement;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const containerRect = el.getBoundingClientRect();
    const itemRect = target.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    const delta = rtl ? itemRect.right - containerRect.right : itemRect.left - containerRect.left;
    el.scrollBy({ left: delta, behavior });
  };

  // 命令式句柄：方法闭包读取实时信号/元素，可随时调用
  const handle: CarouselHandle = {
    scrollNext: () => scrollByDir(1),
    scrollPrev: () => scrollByDir(-1),
    scrollTo: (index: number) => scrollToIndex(index),
    canScrollNext: () => (hasLoop ? hasOverflow() : overflowEnd()),
    canScrollPrev: () => (hasLoop ? hasOverflow() : overflowStart()),
  };

  const assignHandle = () => {
    const hr = local.handleRef;
    if (typeof hr === "function") hr(handle);
    else if (hr) hr.current = handle;
  };
  const clearHandle = () => {
    const hr = local.handleRef;
    if (typeof hr === "function") hr(null);
    else if (hr) hr.current = null;
  };
  onMount(() => {
    assignHandle();
    onCleanup(clearHandle);
  });

  // Shift + 纵向滚轮 → 横向滚动（鼠标无横向滚轮；触控板 deltaX 原生不受影响）
  const onWheel = (e: WheelEvent) => {
    if (!e.shiftKey || e.deltaY === 0 || e.deltaX !== 0) return;
    const el = scrollerEl;
    if (!el) return;
    if (el.scrollWidth <= el.clientWidth) return; // 无可滚内容 → 放行给页面
    e.preventDefault();
    el.scrollBy({ left: e.deltaY, behavior: "auto" });
  };

  // 按钮可见/可用：hasLoop 时只要有溢出两端常驻；否则按单边实时溢出状态
  const canScrollStart = () => (hasLoop && hasOverflow() ? true : overflowStart());
  const canScrollEnd = () => (hasLoop && hasOverflow() ? true : overflowEnd());

  // StyleX 限制：stylex.props 条件需为调用表达式（逻辑/一元表达式与语句级控制流
  // 会在编译期静态求值时炸 Unsupported expression）——遮罩/隐藏判断全部包成
  // 返回 boolean 的函数，用 "fn() && style" 形式传入（互相排斥，后传覆盖前传）
  const isSnap = () => !!local.hasSnap;
  const fadeBoth = () =>
    hasEdgeFade && ((hasLoop && hasOverflow()) || (overflowStart() && overflowEnd()));
  const fadeStart = () => hasEdgeFade && !fadeBoth() && overflowStart();
  const fadeEnd = () => hasEdgeFade && !fadeBoth() && !overflowStart() && overflowEnd();
  const hideStartBtn = () => !canScrollStart();
  const hideEndBtn = () => !canScrollEnd();

  // 根元素：内部 stylex 类 + 外部 class 拼接（与 Button 同策略）
  const mergedAttrs = () => {
    const attrs = stylex.props(styles.root, local.xstyle);
    const external = local.class ?? local.className;
    const className = external == null ? attrs.className : `${attrs.className} ${external}`;
    return { ...attrs, className, style: local.style };
  };

  // scroller 内联样式：gap 与 padding 是动态值（0.5/1.5 无 token），走 style
  const scrollerStyle = () => ({
    gap: GAP_PX[gap],
    ...(local.padding != null
      ? { paddingInline: PAD_PX[local.padding], scrollPaddingInline: PAD_PX[local.padding] }
      : {}),
  });

  const slideCount = () => items().length;

  return (
    <div
      ref={local.ref}
      role="region"
      aria-label={ariaLabel}
      aria-roledescription="carousel"
      data-testid={local["data-testid"]}
      {...mergedAttrs()}
      {...rest}
    >
      <div
        ref={(el) => (scrollerEl = el)}
        tabIndex={0}
        onWheel={onWheel}
        {...stylex.props(
          styles.scroller,
          isSnap() && styles.snap,
          fadeBoth() && styles.fadeBoth,
          fadeStart() && styles.fadeStart,
          fadeEnd() && styles.fadeEnd,
        )}
        style={scrollerStyle()}
      >
        <For each={items()}>
          {(child, i) => (
            // APG carousel：每项是 group + aria-roledescription="slide" + "N of M" 名称，
            // 辅助技术可播报轮播边界与位置
            <div
              role="group"
              aria-roledescription="slide"
              aria-label={t("carousel.slideLabel", { current: i() + 1, total: slideCount() })}
              {...stylex.props(styles.item, local.itemXstyle)}
            >
              {child}
            </div>
          )}
        </For>
      </div>

      <Show when={hasButtons}>
        <div {...stylex.props(styles.buttonOverlay)}>
          <div {...stylex.props(styles.buttonPill, styles.buttonPillStart, hideStartBtn() && styles.buttonHidden)}>
            <Button
              round="full"
              size="sm"
              variant="neutral"
              appear="ghost"
              isIconOnly
              isDisabled={!canScrollStart()}
              icon={<Icon icon="mdi:chevron-left" width={16} />}
              label={t("carousel.prev")}
              onClick={() => scrollByDir(-1)}
            />
          </div>
          <div {...stylex.props(styles.buttonPill, styles.buttonPillEnd, hideEndBtn() && styles.buttonHidden)}>
            <Button
              round="full"
              size="sm"
              variant="neutral"
              appear="ghost"
              isIconOnly
              isDisabled={!canScrollEnd()}
              icon={<Icon icon="mdi:chevron-right" width={16} />}
              label={t("carousel.next")}
              onClick={() => scrollByDir(1)}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}
