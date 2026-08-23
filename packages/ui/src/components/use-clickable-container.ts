/**
 * useClickableContainer（复刻 Astryx useClickableContainer：
 * https://astryx.atmeta.com/components/ClickableCard，接口与行为对齐参考实现
 * github.com/facebook/astryx，MIT）
 * - "Makes a container element clickable while preserving nested interactive
 *   elements"：容器整体可点，嵌套 button/link 等自行处理事件
 * - 有 href → link 语义（Enter 激活、中键/Cmd/Ctrl+点击新标签页打开）
 * - 仅 onClick → button 语义（Enter + Space 激活）
 * - isDisabled → aria-disabled + tabIndex=-1 + 不响应任何激活
 * - options 全部走 getter：Solid props 变化时事件处理器读到最新值
 */

/** 命中即不激活容器的嵌套交互元素（默认集合，可用 interactiveSelector 覆盖） */
export const DEFAULT_INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  "iframe",
  "object",
  "embed",
].join(",");

export interface UseClickableContainerOptions {
  /** 读取器：导航 URL（提供时容器为 link 语义） */
  getHref?: () => string | undefined;
  /** 读取器：链接目标 @default "_self" */
  getTarget?: () => string;
  /** 读取器：点击处理（仅在容器表面触发） */
  getOnClick?: () => ((e: MouseEvent) => void) | undefined;
  /** 读取器：禁用 @default false */
  getDisabled?: () => boolean;
  /** 读取器：可访问名（link/button 语义的 aria-label） */
  getLabel?: () => string | undefined;
  /** 读取器：嵌套交互元素选择器 @default DEFAULT_INTERACTIVE_SELECTOR */
  getInteractiveSelector?: () => string;
}

export interface UseClickableContainerResult {
  /** ref 回调：绑定到容器元素（用于区分容器自身与嵌套元素的键盘激活） */
  setRef: (el: HTMLElement | undefined) => void;
  /** 容器 onClick：表面点击激活；嵌套交互元素命中时跳过 */
  handleClick: (e: MouseEvent) => void;
  /** 容器 onKeyDown：仅容器自身聚焦时响应（Enter / button 语义加 Space） */
  handleKeyDown: (e: KeyboardEvent) => void;
  /** 可访问角色：href → "link"；仅 onClick → "button"；禁用/无动作 → undefined */
  role: () => "link" | "button" | undefined;
  /** tabIndex：禁用 → -1，可交互 → 0 */
  tabIndex: () => number;
  ariaLabel: () => string | undefined;
  ariaDisabled: () => "true" | undefined;
  /** 程序化激活（等价一次表面左键点击） */
  activate: (source?: MouseEvent | KeyboardEvent) => void;
}

function isInteractiveHit(
  target: EventTarget | null,
  root: HTMLElement | undefined,
  selector: string,
): boolean {
  if (target == null || !(target instanceof Element)) return false;
  if (target === root) return false;
  return target.closest(selector) != null;
}

export function useClickableContainer(
  opts: UseClickableContainerOptions,
): UseClickableContainerResult {
  let rootRef: HTMLElement | undefined;
  const setRef = (el: HTMLElement | undefined) => {
    rootRef = el;
  };

  const disabled = () => opts.getDisabled?.() ?? false;
  const href = () => opts.getHref?.();
  const target = () => opts.getTarget?.() ?? "_self";
  const onClick = () => opts.getOnClick?.();
  const label = () => opts.getLabel?.();
  const selector = () => opts.getInteractiveSelector?.() ?? DEFAULT_INTERACTIVE_SELECTOR;

  /** 新标签页打开（中键 / Cmd/Ctrl+点击 / target 非 _self） */
  const openInNewTab = (url: string) => {
    const win = window.open(url, target() === "_self" ? "_blank" : target(), "noopener");
    if (win) win.opener = null;
  };

  /** 左键无修饰点击：先调用方 onClick（可 preventDefault 接管），否则按 target 导航 */
  const navigate = (e: MouseEvent) => {
    onClick()?.(e);
    if (e.defaultPrevented) return;
    if (target() === "_self") window.location.assign(href()!);
    else openInNewTab(href()!);
  };

  const activate = (source?: MouseEvent | KeyboardEvent) => {
    if (disabled()) {
      source?.preventDefault();
      return;
    }
    // 嵌套交互元素：不激活容器（onClick 仅卡面触发）
    if (source && isInteractiveHit(source.target, rootRef, selector())) return;

    const url = href();
    if (url != null) {
      if (source instanceof MouseEvent) {
        const isMiddle = source.button === 1;
        const isModifier = source.metaKey || source.ctrlKey;
        if (isMiddle || isModifier) {
          source.preventDefault();
          openInNewTab(url);
          return;
        }
        source.preventDefault();
        navigate(source);
      } else {
        // 键盘激活（Enter / Space）：合成语义等同左键点击
        const fake = new MouseEvent("click", { bubbles: true, cancelable: true });
        onClick()?.(fake);
        if (fake.defaultPrevented) return;
        if (target() === "_self") window.location.assign(url);
        else openInNewTab(url);
      }
    } else {
      onClick()?.(source instanceof MouseEvent ? source : undefined);
    }
  };

  const handleClick = (e: MouseEvent) => {
    if (disabled()) {
      e.preventDefault();
      return;
    }
    activate(e);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (disabled()) return;
    // 只响应容器自身聚焦（嵌套元素聚焦时其按键归它自己处理）
    if (e.target !== rootRef) return;
    const isLink = href() != null;
    const isEnter = e.key === "Enter";
    const isSpace = e.key === " " || e.key === "Spacebar";
    if (isEnter || (!isLink && isSpace)) {
      e.preventDefault();
      activate(e);
    }
  };

  const role = (): "link" | "button" | undefined => {
    if (disabled()) return undefined;
    if (href() != null) return "link";
    if (onClick() != null) return "button";
    return undefined;
  };

  const tabIndex = () => (role() == null ? -1 : 0);
  const ariaLabel = () => label();
  const ariaDisabled = () => (disabled() ? "true" : undefined);

  return {
    setRef,
    handleClick,
    handleKeyDown,
    role,
    tabIndex,
    ariaLabel,
    ariaDisabled,
    activate,
  };
}
