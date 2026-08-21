import * as stylex from "@stylexjs/stylex";
import { type StyleXStyles } from "@stylexjs/stylex";
import {
  children,
  createEffect,
  createSignal,
  onCleanup,
  splitProps,
  type JSX,
} from "solid-js";
import { colors, dimensions, durations, easings, fontfamilies } from "../theme.stylex";
import { Button } from "./button";
import { Icon } from "./icon";
import { useI18n } from "@dailogues/i18n";

/**
 * Drawer（通用抽屉，复刻 Astryx MobileNav 的 drawer 机制：
 * https://astryx.atmeta.com/components/MobileNav，行为对齐参考实现
 * github.com/facebook/astryx，MIT）
 * - 通用滑出抽屉：从视口一侧滑出的抽屉 + 半透明遮罩，内容任意（导航/菜单/面板）
 * - 站点移动导航（apps/site/src/components/mobile-nav.tsx）基于本组件配置站点内容
 * - 基于原生 <dialog> + showModal()：浏览器自带顶层渲染、焦点圈定（focus trap）、
 *   滚动锁定与 ::backdrop，无需手管 z-index；关闭走原生 cancel（Escape）与点遮罩
 *   （只认 event.target === currentTarget）
 * - 进出场动画：drawer 的 transform 与 ::backdrop 的 opacity 走 transition +
 *   @starting-style（首帧从屏外/透明开始）；dialog 的 display 用
 *   transition-behavior: allow-discrete 延迟翻转——关闭时抽屉滑出动画播完才真正
 *   隐藏（同时规避"关闭未渲染的模态 dialog 导致整页 inert"的浏览器坑）；
 *   全部尊重 prefers-reduced-motion（滑出立即完成，display 保持不缩短——离散值
 *   不产生可见动画，只是 close 落点的窗口）
 * - side="auto"：打开瞬间读取触发元素（activeElement，此时尚未 showModal 移焦）
 *   在视口左/右半区，决定抽屉从 start/end 滑出
 * - 滚动锁：打开期间 documentElement 与最近的滚动祖先 overflow: clip（本应用
 *   实际滚动容器是 shellRoot div 而非 body，必须锁最近滚动祖先），关闭/卸载恢复
 * - 可访问名称：label ?? header（字符串）?? t("mobileNav.navigation")
 * - 受控组件：isOpen/onOpenChange 由消费方管理（本仓库无 AppShell 上下文）
 */

export type DrawerSide = "start" | "end" | "auto";

export interface DrawerProps
  extends Omit<
    JSX.HTMLAttributes<HTMLDialogElement>,
    "open" | "children" | "ref" | "onClick" | "onCancel"
  > {
  /** 是否打开（受控） */
  isOpen: boolean;
  /** 用户请求关闭时回调（遮罩点击 / Escape / 头部关闭按钮）；是否真正关闭由消费方决定 */
  onOpenChange: (isOpen: boolean) => unknown;
  /** 抽屉内容：导航链接等任意节点 */
  children: JSX.Element;
  /** 头部内容（渲染在关闭按钮旁）：字符串渲染为标题，节点原样输出 */
  header?: JSX.Element | string;
  /** 抽屉宽度（px），小屏封顶 85vw 防溢出 @default 320 */
  width?: number;
  /** 从哪一侧滑出：start（LTR 左）/ end（LTR 右）/ auto（按触发元素位置）@default "auto" */
  side?: DrawerSide;
  /** 可访问名称覆盖；缺省回退 header 文本，再回退 t("mobileNav.navigation") */
  label?: string;
  /** 外部注入的 StyleX 样式（最后合并、冲突时覆盖内部） */
  xstyle?: StyleXStyles;
  /** 外部 class（与内部 stylex 类名拼接不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
  /** ref 转发到 dialog 根元素 */
  ref?: (el: HTMLDialogElement) => void;
}

const DARK = "@media (prefers-color-scheme: dark)";
// theme.stylex 无 overlay/border token：遮罩色与抽屉描边内联（与 dialog.tsx 同款遮罩）
const OVERLAY = {
  default: "rgba(0, 0, 0, 0.5)",
  [DARK]: "rgba(0, 0, 0, 0.65)",
} as const;
const BORDER = `color-mix(in srgb, ${colors.onSurface} 12%, transparent)`;

const styles = stylex.create({
  // 原生 <dialog> 默认样式重置：全屏透明容器（drawer 面板绝对定位在其中）
  dialog: {
    position: "fixed",
    inset: 0,
    margin: 0,
    padding: 0,
    // StyleX 0.19 property-specificity 模式不支持 border shorthand（静默丢弃），用 longhand
    borderStyle: "none",
    maxWidth: "none",
    maxHeight: "none",
    width: "100vw",
    height: "100dvh",
    backgroundColor: "transparent",
    // `clip` 而非 `hidden`：clip 不产生滚动容器，@starting-style 进入过渡才能正常绘制
    // （hidden 会让顶层滚动容器子树里的过渡首帧直接跳到终值，抽屉"瞬开"）
    overflow: "clip",
    overscrollBehavior: "contain",
    // 阻止触摸手势（下拉刷新、背景滚动）穿透
    touchAction: "none",
    outline: "none",
    // 关闭时 display:none（不依赖 :where([open])——零特异性会被作者样式覆盖）；
    // display 参与 allow-discrete 过渡：进入立即显示，退出延迟到滑出动画播完再隐藏
    display: "none",
    transitionProperty: "display",
    transitionDuration: durations.durationMediumMin,
    transitionBehavior: "allow-discrete",
  },
  open: { display: "flex" },
  // ::backdrop 由浏览器顶层提供；进入淡入（@starting-style 提供首帧透明度）
  backdrop: {
    "::backdrop": {
      backgroundColor: OVERLAY,
      backdropFilter: "blur(2px)",
      opacity: 0,
      transitionProperty: "opacity",
      transitionDuration: durations.durationMediumMin,
      transitionTimingFunction: easings.easeInOut,
    },
    "@media (prefers-reduced-motion: reduce)": {
      "::backdrop": { transitionDuration: "0.01s" },
    },
  },
  backdropOpen: {
    "::backdrop": {
      opacity: { default: 1, "@starting-style": 0 },
    },
  },
  // 抽屉面板：全高、固定宽度（动态样式单独注入），transform 过渡实现滑入滑出
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: colors.surface,
    color: colors.onSurface,
    boxSizing: "border-box",
    overflow: "hidden",
    transitionProperty: "transform",
    transitionDuration: durations.durationMediumMin,
    transitionTimingFunction: easings.easeInOut,
    outline: "none",
    "@media (prefers-reduced-motion: reduce)": {
      transitionDuration: "0.01s",
    },
  },
  // 从 start（LTR 左侧）滑入：关闭时在屏外，RTL 镜像
  drawerStart: {
    insetInlineStart: 0,
    borderInlineEndWidth: dimensions.borderWidthThin,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: BORDER,
    transform: {
      default: "translateX(-100%)",
      ':is([dir="rtl"] *)': "translateX(100%)",
    },
  },
  drawerStartOpen: {
    // 抽屉在 dialog 关闭时随父级 display:none 未渲染，打开后首个渲染帧没有可供
    // 过渡的"前一值"——@starting-style 给出首帧的屏外 transform，滑入动画得以播放
    transform: {
      default: "translateX(0)",
      "@starting-style": {
        default: "translateX(-100%)",
        ':is([dir="rtl"] *)': "translateX(100%)",
      },
    },
  },
  // 从 end（LTR 右侧）滑入：同 start，镜像边缘
  drawerEnd: {
    insetInlineEnd: 0,
    borderInlineStartWidth: dimensions.borderWidthThin,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: BORDER,
    transform: {
      default: "translateX(100%)",
      ':is([dir="rtl"] *)': "translateX(-100%)",
    },
  },
  drawerEndOpen: {
    transform: {
      default: "translateX(0)",
      "@starting-style": {
        default: "translateX(100%)",
        ':is([dir="rtl"] *)': "translateX(-100%)",
      },
    },
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: dimensions.spacing12,
    paddingInline: dimensions.spacing2,
    flexShrink: 0,
    borderBlockEndWidth: dimensions.borderWidthThin,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: BORDER,
  },
  headerNoTitle: { justifyContent: "flex-end" },
  headerTitle: {
    margin: 0,
    marginInlineStart: dimensions.spacing1,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightMedium,
  },
  content: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehavior: "contain",
    // 重新允许抽屉内容区纵向触摸滚动（dialog 根 touch-action:none 会一并禁用）
    touchAction: "pan-y",
    paddingInline: dimensions.spacing2,
    paddingBlock: dimensions.spacing2,
  },
});

// 抽屉宽度为运行时值（默认 320，小屏封顶 85vw）——动态样式函数
const dynamicStyles = stylex.create({
  width: (w: number) => ({
    width: "100vw",
    maxWidth: `min(${w}px, 85vw)`,
  }),
});

/** 最近一次关闭的最长等待（ms），无论 display 保持多长 */
const MAX_CLOSE_DELAY_MS = 250;
/** 关闭落在 display 保持期的前 60%，避免恰好落在边界上 */
const CLOSE_WITHIN_HOLD = 0.6;

/**
 * 解析 transition-duration 列表中最短的时长（ms）；解析失败返回 null。
 * 浏览器以秒序列化计算值（"0.15s"），jsdom 则原样回显 "150ms"——两种单位都处理。
 */
function parseShortestDurationMs(value: string): number | null {
  const durations = value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      const ms = Number.parseFloat(trimmed);
      if (!Number.isFinite(ms)) return null;
      return trimmed.endsWith("ms") ? ms : trimmed.endsWith("s") ? ms * 1000 : null;
    })
    .filter((ms): ms is number => ms !== null);
  return durations.length ? Math.min(...durations) : null;
}

/**
 * 关闭原生 dialog 前等待多久：抽屉仅在 display 过渡保持期内渲染，而关闭一个
 * 未渲染的模态 dialog 会让整页 inert（浏览器未随 close() 解除阻塞的坑）——
 * 所以 close 必须落在保持期内。保持期 = dialog 的计算 transition-duration
 * （主题可改写，读取实际生效值而非假设）。
 */
function resolveCloseDelay(dialog: HTMLDialogElement): number {
  const cap = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : MAX_CLOSE_DELAY_MS;
  const hold = parseShortestDurationMs(window.getComputedStyle(dialog).transitionDuration);
  if (hold === null) return cap;
  return hold <= 0 ? 0 : Math.min(cap, hold * CLOSE_WITHIN_HOLD);
}

/** 判断元素是否为滚动容器（祖先滚动锁用） */
function isScrollable(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  return /(auto|scroll|overlay)/.test(cs.overflowY) || /(auto|scroll|overlay)/.test(cs.overflowX);
}

const SPLIT_KEYS = [
  "isOpen", "onOpenChange", "header", "width", "side", "label",
  "xstyle", "class", "className", "ref",
] as const;

/** 通用抽屉：复刻 Astryx MobileNav 行为；原生 <dialog> + showModal */
export function Drawer(props: DrawerProps) {
  const { t } = useI18n();
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传：泛化为 Record 后展开（dialog 专属事件的元素类型不兼容）
  const restProps = rest as Record<string, unknown>;

  let dialogEl: HTMLDialogElement | undefined;
  let drawerEl: HTMLDivElement | undefined;
  let triggerEl: HTMLElement | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let lockedEls: Array<{ el: HTMLElement; overflow: string }> = [];

  const setDialogRef = (el: HTMLDialogElement) => {
    dialogEl = el;
    local.ref?.(el);
  };

  // 已解析的滑出侧（side="auto" 时按触发元素位置解析，缺省 end）
  const [resolvedSide, setResolvedSide] = createSignal<"start" | "end">(
    props.side === "auto" || props.side == null ? "end" : props.side,
  );

  // side 解析：声明在开/关 effect 之前——打开瞬间 activeElement 仍是触发元素
  //（showModal 后才移焦），此时读布局才能拿到触发元素位置
  createEffect(() => {
    if (!props.isOpen) return;
    if (props.side === "auto") {
      const trigger =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (trigger != null && trigger !== document.body) {
        const rect = trigger.getBoundingClientRect();
        setResolvedSide(rect.left + rect.width / 2 < window.innerWidth / 2 ? "start" : "end");
      }
    } else {
      setResolvedSide(props.side ?? "end");
    }
  });

  // 滚动锁：锁住 documentElement + 最近的所有滚动祖先（本应用滚动容器是 shellRoot div，
  // 只锁 body/documentElement 无效）；记录原值以便恢复
  const lockScroll = (dialog: HTMLDialogElement) => {
    unlockScroll();
    const seen = new Set<HTMLElement>();
    let el: HTMLElement | null = dialog.parentElement;
    while (el) {
      if (!seen.has(el) && isScrollable(el)) {
        seen.add(el);
        lockedEls.push({ el, overflow: el.style.overflow });
        el.style.overflow = "clip";
      }
      el = el.parentElement;
    }
    if (!seen.has(document.documentElement)) {
      lockedEls.push({
        el: document.documentElement,
        overflow: document.documentElement.style.overflow,
      });
      document.documentElement.style.overflow = "clip";
    }
  };

  const unlockScroll = () => {
    for (const { el, overflow } of lockedEls) el.style.overflow = overflow;
    lockedEls = [];
  };

  // 开/关生命周期：showModal 前记录触发元素（关闭后焦点恢复）；关闭延迟到滑出动画播完
  createEffect(() => {
    const dialog = dialogEl;
    if (!dialog) return;
    if (props.isOpen) {
      // 关闭滑出期间被重新打开：先撤销未触发的关闭定时器（dialog 尚未真正关闭）
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      // 已打开（effect 因其他依赖重跑）时跳过，避免 InvalidStateError
      if (dialog.open) return;
      triggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      lockScroll(dialog);
      dialog.showModal();
      // 焦点给抽屉面板（tabIndex=-1）而非头部关闭按钮，符合"打开即聚焦容器"的惯例
      drawerEl?.focus();
    } else if (dialog.open) {
      const trigger = triggerEl;
      triggerEl = null;
      // 关闭开始即恢复背景滚动（参考实现语义）；dialog.close() 延迟到滑出动画播完
      unlockScroll();
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (dialog.open) dialog.close();
        // 焦点恢复触发元素（打开时记录的汉堡按钮；已卸载则跳过）
        if (trigger != null && trigger.isConnected) trigger.focus();
      }, resolveCloseDelay(dialog));
    }
  });

  // 卸载兜底：清理定时器 / 恢复滚动锁 / 关闭仍打开的 dialog
  onCleanup(() => {
    if (closeTimer) clearTimeout(closeTimer);
    unlockScroll();
    if (dialogEl?.open) dialogEl.close();
  });

  // 原生 cancel（Escape）：拦截浏览器默认关闭，交还消费方决定
  const handleCancel = (e: Event) => {
    e.preventDefault();
    props.onOpenChange(false);
  };

  // 点遮罩：只认 dialog 元素本身（内容点击不算）
  const handleDialogClick = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    props.onOpenChange(false);
  };

  // stylex.props 条件必须是调用表达式或直接引用 props——取值判断统一包成函数
  // lazy prop（header 可为 JSX 元素）children() 包装，防 hydration mismatch（同 Button icon）
  const headerNode = children(() => local.header);
  const isStart = () => resolvedSide() === "start";
  const isEnd = () => resolvedSide() === "end";
  // stylex.props 条件不支持「调用表达式开头的 3 元逻辑链」（生产模式静态求值炸
  // Unsupported expression）——打开态判定合并成复合调用，保持 2 元链
  const isStartOpen = () => isStart() && props.isOpen;
  const isEndOpen = () => isEnd() && props.isOpen;
  const noHeader = () => headerNode() == null;
  const dialogLabel = () =>
    props.label ?? (typeof headerNode() === "string" ? (headerNode() as string) : t("mobileNav.navigation"));

  // 外部 class/className 不能走 rest 透传：Solid 中后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className，必须显式拼接
  const mergedAttrs = () => {
    const attrs = stylex.props(
      styles.dialog,
      props.isOpen && styles.open,
      styles.backdrop,
      props.isOpen && styles.backdropOpen,
      // 外部注入的 StyleX 样式放最后：与内部样式冲突时外部覆盖
      props.xstyle,
    );
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  return (
    <dialog
      {...restProps}
      ref={setDialogRef}
      aria-label={dialogLabel()}
      onClick={handleDialogClick}
      onCancel={handleCancel}
      {...mergedAttrs()}
    >
      {/* 抽屉面板——tabIndex 让 showModal 聚焦面板而非关闭按钮 */}
      <div
        ref={(el) => {
          drawerEl = el;
        }}
        tabIndex={-1}
        {...stylex.props(
          styles.drawer,
          dynamicStyles.width(local.width ?? 320),
          isStart() && styles.drawerStart,
          isStartOpen() && styles.drawerStartOpen,
          isEnd() && styles.drawerEnd,
          isEndOpen() && styles.drawerEndOpen,
        )}
      >
        {/* 头部——内容 + 关闭按钮 */}
        <div {...stylex.props(styles.header, noHeader() && styles.headerNoTitle)}>
          {typeof headerNode() === "string" ? (
            <h2 {...stylex.props(styles.headerTitle)}>{headerNode()}</h2>
          ) : (
            (headerNode() ?? null)
          )}
          <Button
            variant="neutral"
            appear="ghost"
            size="sm"
            label={t("mobileNav.closeNavigation")}
            icon={<Icon icon="iconoir:xmark" />}
            isIconOnly
            onClick={() => props.onOpenChange(false)}
          />
        </div>

        {/* 可滚动内容区 */}
        <div {...stylex.props(styles.content)}>{props.children}</div>
      </div>
    </dialog>
  );
}

Drawer.displayName = "Drawer";