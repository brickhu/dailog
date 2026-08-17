import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  createEffect,
  createUniqueId,
  onCleanup,
  splitProps,
  useContext,
  type JSX,
} from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, easings, shadows } from "../theme.stylex";

/**
 * Dialog（复刻 Astryx Dialog：https://astryx.atmeta.com/components/Dialog，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 基于原生 <dialog> + showModal()：浏览器自带模态层、焦点圈定（focus trap）与
 *   ::backdrop；打开前记录触发元素（动画起点 + 关闭后焦点恢复），打开后聚焦第一个
 *   [data-autofocus] 元素（挂载期 autofocus 在 showModal 前会静默失败，故打开时手动聚焦）
 * - purpose 决定退出方式：info = Escape + 点遮罩；form = 仅 Escape；required = 全部禁用
 *   且 role="alertdialog"（阻断原生 cancel 防止浏览器擅自关闭）
 * - Escape 走 keydown + onCancel 双保险：IME 输入法取消键（isComposing/keyCode 229）过滤；
 *   preventDefault 后交还消费方 onOpenChange(false)（受控组件，是否关闭由消费方决定）
 * - 分层弹层：模块级注册表（pushEscapeLayer/isTopEscapeLayer），单次 Escape 只关最上层
 *   （未来 popover/menu 打开时 push 自己的 handler 并 stopPropagation 即可接入）
 * - 点遮罩只认 event.target === currentTarget（避免原生弹层 date picker 等误判）
 * - 滚动锁（body overflow hidden）带嵌套计数，多弹层叠加时正确还原
 * - 可访问名称：DialogContext 下发 titleId，标题元素渲染后回写 aria-labelledby
 *   （消费方显式 aria-label/aria-labelledby 优先且不被改动）；打开的模态弹窗无名称
 *   时 console.warn 一次（dev 提示）
 * - 进入动画从触发元素方向位移（--dialog-dir-x/y 自定义属性），尊重 prefers-reduced-motion
 * - variant="fullscreen" 铺满视口（忽略 width/maxHeight/position/padding 尺寸约束）
 * - isInline：纯文档预览模式——无 <dialog>、无模态行为/焦点管理/Escape/滚动锁
 * - 变量全部使用 theme.stylex 非废弃 tokens（colors/dimensions/durations/easings/shadows）；
 *   theme.stylex 暂无 overlay token，遮罩色内联定义
 */

export type DialogVariant = "standard" | "fullscreen";
export type DialogPurpose = "info" | "required" | "form";
/** 间距档位（对应 theme.stylex spacingN；非整数档为 2px/6px） */
export type SpacingStep = 0 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6 | 8 | 10;

/** 屏幕位置偏移（逻辑方向，RTL 下自动镜像）；全部缺省时居中 */
export interface DialogPosition {
  top?: number | string;
  bottom?: number | string;
  start?: number | string;
  end?: number | string;
}

export interface DialogContextValue {
  isInline: () => boolean;
  titleId: string;
}

export interface DialogProps
  extends Omit<JSX.HTMLAttributes<HTMLDialogElement>, "open" | "ref" | "children"> {
  /** 是否打开（受控） */
  isOpen: boolean;
  /** 用户请求关闭时回调（Escape/点遮罩）；是否真正关闭由消费方决定 */
  onOpenChange: (isOpen: boolean) => unknown;
  children: JSX.Element;
  /** 纯展示模式：无 <dialog>/模态行为（文档预览用） */
  isInline?: boolean;
  /** 宽度：数字=px，字符串原样；fullscreen 忽略 */
  width?: number | string;
  /** 最大高度：数字=px，字符串原样；fullscreen 忽略 */
  maxHeight?: number | string;
  /** 屏幕位置偏移；缺省居中（margin: auto） */
  position?: DialogPosition;
  variant?: DialogVariant;
  /** 退出方式：info 全开 / form 禁点遮罩 / required 全禁 + alertdialog */
  purpose?: DialogPurpose;
  /** 内边距档位（默认 4 = 16px） */
  padding?: SpacingStep;
  xstyle?: StyleXStyles;
  ref?: (el: HTMLDialogElement) => void;
  /** 外部 class（Solid 别名，与 class 等价；与内部 stylex 类名拼接不覆盖） */
  className?: string;
}

const DARK = "@media (prefers-color-scheme: dark)";
// theme.stylex 无 overlay token：遮罩色内联（浅色 50% / 深色 65%，与 Astryx 视觉一致）
const OVERLAY = {
  default: "rgba(0, 0, 0, 0.5)",
  [DARK]: "rgba(0, 0, 0, 0.65)",
} as const;

// 进入动画：从触发元素方向（--dialog-dir-x/y）位移 + 轻微缩小入场
const dialogEnter = stylex.keyframes({
  from: {
    opacity: 0,
    transform: "translate(var(--dialog-dir-x, 0px), var(--dialog-dir-y, 16px)) scale(0.95)",
  },
  to: {
    opacity: 1,
    transform: "translate(0, 0) scale(1)",
  },
});

const styles = stylex.create({
  dialog: {
    position: "fixed",
    inset: 0,
    margin: "auto",
    boxSizing: "border-box",
    // StyleX 0.19 property-specificity 模式不支持 border shorthand（静默丢弃），用 longhand
    borderStyle: "none",
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    boxShadow: shadows.shadowHigh,
    animationName: dialogEnter,
    animationDuration: durations.durationMediumMin,
    animationTimingFunction: easings.easeOut,
    animationFillMode: "backwards",
    "@media (prefers-reduced-motion: reduce)": {
      animationName: "none",
    },
    "::backdrop": {
      backgroundColor: OVERLAY,
      backdropFilter: "blur(2px)",
    },
  },
  // 打开时显式 display（不依赖 :where([open]) 选择器——零特异性，会被作者样式覆盖）
  open: { display: "flex" },
  fullscreen: {
    width: "100dvw",
    height: "100dvh",
    maxWidth: "100dvw",
    maxHeight: "100dvh",
    borderRadius: dimensions.radius0,
    margin: 0,
    inset: 0,
  },
  // 内容容器：flex 纵向 + 圆角裁切；内容超高时在框内滚动（maxHeight 约束生效）
  inner: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    overflow: "auto",
    borderRadius: "inherit",
  },
  inline: {
    boxSizing: "border-box",
    borderRadius: dimensions.radiusXl,
    backgroundColor: colors.surface,
    color: colors.onSurface,
    boxShadow: shadows.shadowHigh,
  },
});

// padding 档位 → 项目 spacing tokens（0.5/1.5 为 2px/6px，token 无此档位）
const paddingStyles = stylex.create({
  s0: { padding: dimensions.spacing0 },
  s0_5: { padding: "2px" },
  s1: { padding: dimensions.spacing1 },
  s1_5: { padding: "6px" },
  s2: { padding: dimensions.spacing2 },
  s3: { padding: dimensions.spacing3 },
  s4: { padding: dimensions.spacing4 },
  s5: { padding: dimensions.spacing5 },
  s6: { padding: dimensions.spacing6 },
  s8: { padding: dimensions.spacing8 },
  s10: { padding: dimensions.spacing10 },
});

// ---- 模块级分层弹层注册表（未来 popover/menu 等弹层打开时 push 自己的 handler，
// 并在自己的 Escape 处理里 stopPropagation + preventDefault，即实现"单次只关最上层"）----
type EscapeLayerHandler = () => void;
const escapeLayerStack: EscapeLayerHandler[] = [];

/** 注册一个 Escape 处理层，返回注销函数；栈顶（最上层）处理 Escape */
export function pushEscapeLayer(handler: EscapeLayerHandler): () => void {
  escapeLayerStack.push(handler);
  return () => {
    const index = escapeLayerStack.indexOf(handler);
    if (index >= 0) escapeLayerStack.splice(index, 1);
  };
}

/** handler 是否当前栈顶（是则应当处理本次 Escape） */
export function isTopEscapeLayer(handler: EscapeLayerHandler): boolean {
  return escapeLayerStack[escapeLayerStack.length - 1] === handler;
}

// ---- 滚动锁（嵌套计数：多弹层叠加时只有最后一层解锁才真正还原 body overflow）----
let scrollLockCount = 0;
let savedBodyOverflow: string | null = null;

function lockBodyScroll() {
  scrollLockCount += 1;
  if (scrollLockCount === 1) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0 && savedBodyOverflow != null) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = null;
  }
}

// ---- 工具 ----

/** IME 输入法组合/取消键（keyCode 229）不算 Escape 关闭 */
function isImeKeyEvent(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

/** 触发元素中心 → 视口中心的方向向量，归一化后缩放为动画位移（距离 px） */
function getDialogDirection(trigger: HTMLElement | null, distance = 16): { x: number; y: number } {
  if (trigger == null) return { x: 0, y: distance };
  const rect = trigger.getBoundingClientRect();
  const dx = window.innerWidth / 2 - (rect.left + rect.width / 2);
  const dy = window.innerHeight / 2 - (rect.top + rect.height / 2);
  const magnitude = Math.hypot(dx, dy) || 1;
  return {
    x: Math.round((dx / magnitude) * distance),
    y: Math.round((dy / magnitude) * distance),
  };
}

function toLength(v: number | string | undefined, fallback: string): string {
  if (v == null) return fallback;
  return typeof v === "number" ? `${v}px` : v;
}

/** position 偏移预解析（数字→px，缺省→auto；StyleX 无法静态分析辅助函数，故运行时展开） */
function resolvePosition(position?: DialogPosition): JSX.CSSProperties | undefined {
  if (position == null) return undefined;
  const toCss = (v?: number | string) => (v == null ? "auto" : typeof v === "number" ? `${v}px` : v);
  return {
    top: toCss(position.top),
    bottom: toCss(position.bottom),
    "inset-inline-start": toCss(position.start),
    "inset-inline-end": toCss(position.end),
  };
}

export const DialogContext = createContext<DialogContextValue | undefined>(undefined);

/** 读取 Dialog 上下文（isInline 状态 + 标题 id，供自定义标题元素接入可访问名称） */
export function useDialogContext(): DialogContextValue | undefined {
  return useContext(DialogContext);
}

const SPLIT_KEYS = [
  "isOpen", "onOpenChange", "isInline", "width", "maxHeight", "position",
  "variant", "purpose", "padding", "xstyle", "style", "class", "className", "ref",
] as const;

/** 模态弹窗（两站共享）：复刻 Astryx Dialog 行为；原生 <dialog> + showModal */
export function Dialog(props: DialogProps) {
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // 原生属性透传：泛化为 Record 后展开（dialog 专属事件的元素类型与 div 分支不兼容，
  // 同 button 的 anchor 分支做法）
  const restProps = rest as Record<string, unknown>;

  let dialogEl: HTMLDialogElement | undefined;
  let inlineEl: HTMLDivElement | undefined;
  let triggerEl: HTMLElement | null = null;
  let warnedNoName = false;

  const setDialogRef = (el: HTMLDialogElement) => {
    dialogEl = el;
    local.ref?.(el);
  };
  const setInlineRef = (el: HTMLDivElement) => {
    inlineEl = el;
    (local.ref as ((el: unknown) => void) | undefined)?.(el);
  };

  const isInline = () => local.isInline === true;
  const isFullscreen = () => (local.variant ?? "standard") === "fullscreen";
  const isPurpose = (p: DialogPurpose) => (local.purpose ?? "info") === p;
  // 取值判断统一包成调用表达式（供 stylex.props 条件使用；直接引用 splitProps 的
  // local/组件内 const 触发 Unsupported expression，故条件内用 props 参数取值）
  const isPadding = (s: SpacingStep) => (props.padding ?? 4) === s;

  // purpose → 退出方式
  const allowEscape = () => !isPurpose("required");
  const allowBackdropClick = () => isPurpose("info");

  // 可访问名称：DialogContext 下发 titleId，标题元素渲染后回写 aria-labelledby
  const titleId = createUniqueId();
  const contextValue: DialogContextValue = {
    isInline: () => props.isInline === true,
    titleId,
  };
  const hasExplicitName = () => props["aria-label"] != null || props["aria-labelledby"] != null;

  // 打开/关闭生命周期：showModal 前记录触发元素 + 动画方向；关闭后恢复焦点
  createEffect(() => {
    const open = props.isOpen;
    const inline = props.isInline === true;
    const el = dialogEl;
    if (inline || !el) return;
    if (open) {
      // 已打开（effect 因其他依赖重跑）时跳过，避免 InvalidStateError
      if (el.open) return;
      triggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const dir = getDialogDirection(triggerEl);
      el.style.setProperty("--dialog-dir-x", `${dir.x}px`);
      el.style.setProperty("--dialog-dir-y", `${dir.y}px`);
      el.showModal();
      // React/Solid 的 autofocus 属性在挂载期调用 .focus()，早于 showModal() 可见，会静默失败
      const autoFocusEl = el.querySelector<HTMLElement>("[data-autofocus]");
      autoFocusEl?.focus();
    } else {
      if (el.open) el.close();
      const trigger = triggerEl;
      triggerEl = null;
      if (trigger != null && trigger.isConnected) trigger.focus();
    }
  });

  // Escape 层注册：打开期间入栈（关闭/卸载时自动出栈）
  const escapeHandler = () => {
    props.onOpenChange(false);
  };
  createEffect(() => {
    const active = props.isOpen && props.isInline !== true;
    if (!active) return;
    const dispose = pushEscapeLayer(escapeHandler);
    onCleanup(dispose);
  });

  // 滚动锁：打开期间锁 body overflow（嵌套计数）
  createEffect(() => {
    const active = props.isOpen && props.isInline !== true;
    if (!active) return;
    lockBodyScroll();
    onCleanup(unlockBodyScroll);
  });

  // 可访问名称回写 + 未命名弹窗 dev 警告（打开时标题可能刚渲染，故依赖 isOpen）
  createEffect(() => {
    const el = dialogEl ?? inlineEl;
    if (!el) return;
    props.isOpen;
    const titleEl = el.querySelector(`#${CSS.escape(titleId)}`);
    if (hasExplicitName() || titleEl == null) el.removeAttribute("aria-labelledby");
    else el.setAttribute("aria-labelledby", titleId);
    if (
      !warnedNoName &&
      props.isOpen &&
      props.isInline !== true &&
      !hasExplicitName() &&
      titleEl == null
    ) {
      warnedNoName = true;
      console.warn(
        "[Dialog] 打开的模态弹窗没有可访问名称：请传 aria-label，或在内容里渲染 " +
          `id="${titleId}" 的标题元素（可借助 useDialogContext()）`,
      );
    }
  });

  // Escape：keydown（含 IME 过滤 + 分层让位）+ onCancel 原生路径双保险
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || isImeKeyEvent(e)) return;
    // 有更上层弹层（popover/menu）时让位，由最上层处理本次 Escape
    if (!isTopEscapeLayer(escapeHandler)) return;
    e.preventDefault();
    if (allowEscape()) props.onOpenChange(false);
  };
  const handleCancel = (e: Event) => {
    if (!isTopEscapeLayer(escapeHandler)) return;
    e.preventDefault();
    // required：阻断原生 cancel，浏览器不能擅自关闭
    if (allowEscape()) props.onOpenChange(false);
  };

  // 点遮罩：只认 dialog 元素本身（内容点击不算）；避免原生弹层（date picker 等）
  // 渲染在 dialog 包围盒外的误判
  const handleClick = (e: MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    if (allowBackdropClick()) props.onOpenChange(false);
  };

  // 动态尺寸（width/maxHeight/position 是运行时值，走内联 style；fullscreen 为静态类）
  const mergedStyle = () => {
    const dynamic: JSX.CSSProperties = {};
    if (!isFullscreen()) {
      dynamic.width = toLength(props.width, "400px");
      dynamic["max-width"] = "90vw";
      dynamic["max-height"] = toLength(props.maxHeight, "75vh");
      const pos = resolvePosition(props.position);
      if (pos != null) Object.assign(dynamic, pos, { margin: 0 });
    }
    // string style 不参与合并（动态尺寸丢失）；推荐对象 style 或 xstyle
    return typeof local.style === "object" ? { ...dynamic, ...local.style } : dynamic;
  };

  // 外部 class/className 不能走 rest 透传：Solid 中后 spread 的 class 会整体覆盖
  // 内部 stylex 生成的 className（内部样式类全部丢失），必须显式拼接
  const mergeExternalClass = (attrs: Record<string, unknown>) => {
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  const modalProps = () =>
    mergeExternalClass(
      stylex.props(
        styles.dialog,
        isFullscreen() && styles.fullscreen,
        props.isOpen && styles.open,
        isPadding(0) && paddingStyles.s0,
        isPadding(0.5) && paddingStyles.s0_5,
        isPadding(1) && paddingStyles.s1,
        isPadding(1.5) && paddingStyles.s1_5,
        isPadding(2) && paddingStyles.s2,
        isPadding(3) && paddingStyles.s3,
        isPadding(4) && paddingStyles.s4,
        isPadding(5) && paddingStyles.s5,
        isPadding(6) && paddingStyles.s6,
        isPadding(8) && paddingStyles.s8,
        isPadding(10) && paddingStyles.s10,
        // 外部注入的 StyleX 样式放最后：与内部样式冲突时外部覆盖
        props.xstyle,
      ),
    );

  const inlineProps = () =>
    mergeExternalClass(
      stylex.props(
        styles.inline,
        isPadding(0) && paddingStyles.s0,
        isPadding(0.5) && paddingStyles.s0_5,
        isPadding(1) && paddingStyles.s1,
        isPadding(1.5) && paddingStyles.s1_5,
        isPadding(2) && paddingStyles.s2,
        isPadding(3) && paddingStyles.s3,
        isPadding(4) && paddingStyles.s4,
        isPadding(5) && paddingStyles.s5,
        isPadding(6) && paddingStyles.s6,
        isPadding(8) && paddingStyles.s8,
        isPadding(10) && paddingStyles.s10,
        props.xstyle,
      ),
    );

  const innerContent = (
    <DialogContext.Provider value={contextValue}>{props.children}</DialogContext.Provider>
  );

  if (isInline()) {
    // 纯展示模式：无 <dialog>、无模态行为/焦点管理/Escape/滚动锁
    if (!props.isOpen) return null;
    return (
      <div {...restProps} ref={setInlineRef} style={mergedStyle()} {...inlineProps()}>
        {innerContent}
      </div>
    );
  }

  return (
    <dialog
      {...restProps}
      ref={setDialogRef}
      role={isPurpose("required") ? "alertdialog" : undefined}
      onClick={handleClick}
      onCancel={handleCancel}
      onKeyDown={handleKeyDown}
      style={mergedStyle()}
      {...modalProps()}
    >
      <div {...stylex.props(styles.inner)}>{innerContent}</div>
    </dialog>
  );
}

Dialog.displayName = "Dialog";
