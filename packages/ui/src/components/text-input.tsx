import * as stylex from "@stylexjs/stylex";
import { children, createSignal, createUniqueId, Show, splitProps, type JSX } from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, fontfamilies } from "../theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Icon } from "./icon";
import { Spinner } from "./spinner";
import { Tooltip } from "./tooltip";

/**
 * TextInput（复刻 Astryx TextInput：https://astryx.atmeta.com/components/TextInput，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 受控组件：value + onChange(value, e)；changeAction 异步变更 → pending spinner + aria-busy
 * - 视觉规格（本仓库定制）：底色 colors.surface、边框 colors.surfaceStrong、默认字色 colors.onSurface，
 *   占位符/辅助文本用 onSurface 低透明度；focus-within 边框转 onSurface + 柔和光环
 * - status（error/warning/success）→ colors.danger/warning/success：边框/图标/消息框全套着色
 * - 颜色全变量化：内部所有颜色读取 --ti-* CSS 变量（根元素声明，默认取自 theme.stylex tokens），
 *   外部经 colorVars prop / 任意祖先元素 / CSS 规则覆盖（变量经继承生效）
 * - hasClear：有值时显示 ✕ 清除按钮（清空 + 回焦）；disabledMessage：禁用原因 tooltip
 *   （aria-disabled + readOnly 保持键盘可达）；labelTooltip：标签行信息图标 tooltip
 * - 组件始终渲染 label（isLabelHidden 时视觉隐藏），aria-labelledby/aria-describedby 完整接线
 */

// 组件颜色变量：内部样式全部引用 var(--ti-*)（在组件根元素声明默认值，见 styles.root），
// 外部通过 colorVars prop / 祖先 CSS 变量覆盖即可整体换色，无需改组件源码
const TI = {
  bg: "var(--ti-bg)",
  border: "var(--ti-border)",
  text: "var(--ti-text)",
  muted: "var(--ti-muted)",
  focusBg: "var(--ti-focus-bg)",
  error: "var(--ti-error)",
  warning: "var(--ti-warning)",
  success: "var(--ti-success)",
};

const styles = stylex.create({
  // —— 字段根：声明组件颜色变量默认值（取自 theme.stylex tokens）——
  // 外部可用 colorVars prop（内联，优先级最高）、任意祖先元素或 CSS 规则覆盖
  root: {
    "--ti-bg": colors.surface,
    "--ti-border": colors.surfaceStrong,
    "--ti-text": colors.onSurface,
    // muted/占位符/焦点光环等由 --ti-text 派生（覆盖 --ti-text 自动跟随）
    "--ti-muted": "color-mix(in srgb, var(--ti-text) 60%, transparent)",
    // 聚焦底色：--ti-bg 与 --ti-text 的 94/6 混色（覆盖 --ti-bg/--ti-text 自动跟随）
    "--ti-focus-bg": "color-mix(in srgb, var(--ti-bg) 94%, var(--ti-text) 6%)",
    "--ti-error": colors.danger,
    "--ti-warning": colors.warning,
    "--ti-success": colors.success,
  },
  // —— 字段根：label 行 + 描述 + 输入容器 + 状态消息 ——
  labelRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing1,
    marginBottom: dimensions.spacing1,
  },
  labelText: {
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightMedium,
    lineHeight: "1.5",
    color: TI.text,
  },
  requiredMark: { color: TI.error },
  optionalMark: {
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightNormal,
    color: TI.muted,
  },
  description: {
    marginBottom: dimensions.spacing1,
    fontSize: dimensions.fontSizeXs,
    lineHeight: "1.5",
    color: TI.muted,
  },
  visuallyHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  // —— 输入容器：surface 底 + surfaceStrong 边框 + onSurface 字 ——
  wrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    boxSizing: "border-box",
    width: "100%",
    paddingInline: dimensions.spacing3,
    backgroundColor: TI.bg,
    borderWidth: dimensions.borderWidthThin,
    borderStyle: "solid",
    borderColor: TI.border,
    borderRadius: dimensions.radiusMd,
    color: TI.text,
    lineHeight: "1.5",
    cursor: "text",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: {
      default: durations.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    ":focus-within": {
      backgroundColor: TI.focusBg,
      borderColor: TI.text,
      boxShadow: "0 0 0 2px color-mix(in srgb, " + TI.text + " 18%, transparent)",
    },
  },
  // 锚点容器：包住输入容器 + 禁用原因 tooltip——tooltip 放在 opacity 容器之外，
  // 避免容器禁用态 opacity 把 tooltip 一起淡化（见 wrapperDisabled）
  wrapperAnchor: {
    position: "relative",
  },
  wrapperDisabled: {
    cursor: "not-allowed",
    // 整体透明度 0.55 之外，边框与文字再单独减淡（color-mix 透明化），禁用观感更弱
    opacity: 0.55,
    borderColor: "color-mix(in srgb, " + TI.border + " 60%, transparent)",
    color: "color-mix(in srgb, " + TI.text + " 60%, transparent)",
  },
  // attached：输入框容器也铺 banner 底色（透明露出 statusStack 底色，与 banner 同色），
  // 底边保留边框（不透明）：输入框轮廓完整、banner 明确位于其下方；聚焦底色也透明，
  // 避免聚焦时跳回 surface 底色
  wrapperAttached: {
    backgroundColor: "transparent",
    ":focus-within": {
      backgroundColor: "transparent",
    },
  },
  startIconSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  input: {
    display: "block",
    flex: 1,
    minWidth: 0,
    // 不设 width：flex:1 + minWidth:0 已撑满剩余空间；设 width:100% 会与 flex-basis:0
    // 产生亚像素差（左右各约 1px 挤压，聚焦 outline 可见）
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    fontFamily: fontfamilies.body,
    fontSize: "inherit",
    lineHeight: "inherit",
    color: TI.text,
    backgroundColor: "transparent",
    outline: "none",
    "::placeholder": {
      color: "color-mix(in srgb, " + TI.text + " 55%, transparent)",
    },
  },
  inputDisabled: {
    cursor: "not-allowed",
    // 占位符同步减淡（40% × 容器 0.55），避免比减淡后的输入文字更醒目
    "::placeholder": {
      color: "color-mix(in srgb, " + TI.text + " 40%, transparent)",
    },
  },
  clearButton: {
    position: "relative", // tooltip 锚点（标签信息图标 / 状态 tooltip 变体）
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
    ":hover": {
      backgroundColor: "color-mix(in srgb, " + TI.border + " 55%, transparent)",
    },
    ":focus-visible": {
      outline: "2px solid " + TI.border,
      outlineOffset: "1px",
    },
  },
  statusIconSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  // —— 字段栈：attached 时承载「输入框 + banner」整块共用的 banner 底色 ——
  // attached 下输入框容器与 banner 本体均为透明底，露出本层底色 → 整个区块是一整块
  // 同色圆角背景，无缝衔接。顶角 radiusMd（跟随输入框圆角）、底角 radiusSm（跟随 banner）
  statusStack: {
    borderTopLeftRadius: dimensions.radiusMd,
    borderTopRightRadius: dimensions.radiusMd,
    borderBottomLeftRadius: dimensions.radiusSm,
    borderBottomRightRadius: dimensions.radiusSm,
  },
  // —— 状态消息框 ——
  messageBox: {
    display: "flex",
    alignItems: "center",
    // attached（默认）：紧贴输入框下方；detached 经 messageDetached 加大间距
    marginTop: dimensions.spacing2,
    padding: dimensions.spacing1 + " " + dimensions.spacing2,
    borderRadius: dimensions.radiusSm,
    fontSize: dimensions.fontSizeXs,
    lineHeight: "1.5",
  },
  messageDetached: { marginTop: dimensions.spacing2 },
  // attached：底色由 statusStack 承担，banner 本体透明（否则会在底色上二次染色变深）
  messageAttached: { backgroundColor: "transparent" },
});

// 高度档位与 Button 完全对齐（button.tsx sizeStyles 同款）：
// 高度 = 档位高度 + 档位附加（sm=+0/md=+spacing1(4px)/lg=+spacing2(8px)）→ 24/36/48px；
// 左右间距（横向 padding，单侧）= 整体高度 × 0.25（输入框比按钮 0.5 更紧凑）→ 6/9/12px；
// sm=24px/12px/6px、md=36px/16px/9px、lg=48px/16px/12px（输入框继承 wrapper 的 fontSize）
const sizeStyles = stylex.create({
  sm: {
    height: dimensions.sizeSm,
    fontSize: dimensions.fontSizeXs,
    paddingInline: "calc(" + dimensions.sizeSm + " * 0.25)",
  },
  md: {
    height: "calc(" + dimensions.sizeMd + " + " + dimensions.spacing1 + ")",
    fontSize: dimensions.fontSizeMd,
    paddingInline: "calc((" + dimensions.sizeMd + " + " + dimensions.spacing1 + ") * 0.25)",
  },
  lg: {
    height: "calc(" + dimensions.sizeLg + " + " + dimensions.spacing2 + ")",
    fontSize: dimensions.fontSizeMd,
    paddingInline: "calc((" + dimensions.sizeLg + " + " + dimensions.spacing2 + ") * 0.25)",
  },
});

// 校验状态：边框色（含 focus-within）+ 图标色 + 消息框底色，全部读取 --ti-error/warning/success
// 消息框底色 = 状态色 12% 淡染（与字色同源，外部只需配一个状态色即可全套生效）
const statusStyles = stylex.create({
  borderError: {
    borderColor: TI.error,
    ":focus-within": { borderColor: TI.error },
  },
  borderWarning: {
    borderColor: TI.warning,
    ":focus-within": { borderColor: TI.warning },
  },
  borderSuccess: {
    borderColor: TI.success,
    ":focus-within": { borderColor: TI.success },
  },
  iconError: { color: TI.error },
  iconWarning: { color: TI.warning },
  iconSuccess: { color: TI.success },
  messageError: {
    backgroundColor: "color-mix(in srgb, " + TI.error + " 12%, transparent)",
    color: TI.error,
  },
  messageWarning: {
    backgroundColor: "color-mix(in srgb, " + TI.warning + " 12%, transparent)",
    color: TI.warning,
  },
  messageSuccess: {
    backgroundColor: "color-mix(in srgb, " + TI.success + " 12%, transparent)",
    color: TI.success,
  },
  // attached 字段栈底色（仅底色，字色由 message* 负责）：与 banner 同款 12% 淡染
  stackError: { backgroundColor: "color-mix(in srgb, " + TI.error + " 12%, transparent)" },
  stackWarning: { backgroundColor: "color-mix(in srgb, " + TI.warning + " 12%, transparent)" },
  stackSuccess: { backgroundColor: "color-mix(in srgb, " + TI.success + " 12%, transparent)" },
});

const STATUS_ICONS: Record<TextInputStatusType, string> = {
  error: "mdi:alert-circle",
  warning: "mdi:alert",
  success: "mdi:check-circle",
};
const STATUS_INFO_ICON = "mdi:information-outline";

export type TextInputType =
  | "text"
  | "password"
  | "email"
  | "url"
  | "tel"
  | "search"
  | "number";
export type TextInputSize = "sm" | "md" | "lg";
export type TextInputStatusType = "error" | "warning" | "success";
export type TextInputStatusVariant = "attached" | "detached" | "tooltip";

export interface TextInputStatus {
  /** 状态类型：error 阻止提交 / warning 允许提交 / success 校验通过 */
  type: TextInputStatusType;
  /** 状态消息：提供时显示消息框（tooltip 变体显示为 tooltip） */
  message?: string;
}

/**
 * TextInput 颜色变量：内部元素颜色全部经这些 CSS 变量注入，外部可整体配置。
 * 默认值取自 theme.stylex tokens（组件根元素声明）；覆盖方式：
 *  - colorVars prop（内联样式，优先级最高）
 *  - 任意祖先元素上设同名 CSS 变量（经继承生效）
 *  - CSS 规则 / stylex 类（作用于根元素或祖先）
 * muted/占位符/焦点光环等由 --ti-text 派生，覆盖 --ti-text 会自动跟随。
 */
export type TextInputColorVars = {
  /** 输入容器底色 @default colors.surface */
  "--ti-bg"?: string;
  /** 输入容器边框 @default colors.surfaceStrong */
  "--ti-border"?: string;
  /** 默认字色（输入文本/标签/焦点边框与光环） @default colors.onSurface */
  "--ti-text"?: string;
  /** 次要文本色（描述/选填标记） @default --ti-text 60% */
  "--ti-muted"?: string;
  /** 聚焦底色（focus-within 容器底色） @default --ti-bg 与 --ti-text 的 94/6 混色 */
  "--ti-focus-bg"?: string;
  /** error 状态色（边框/图标/消息框） @default colors.danger */
  "--ti-error"?: string;
  /** warning 状态色 @default colors.warning */
  "--ti-warning"?: string;
  /** success 状态色 @default colors.success */
  "--ti-success"?: string;
};

export interface TextInputProps
  extends Omit<
    JSX.InputHTMLAttributes<HTMLInputElement>,
    | "value" | "onChange" | "onInput" | "onKeyDown" | "ref"
    | "class" | "className" | "style" | "name" | "type" | "autofocus" | "id"
  > {
  /** HTML input type @default "text" */
  type?: TextInputType;
  /** 可访问标签（组件始终渲染；isLabelHidden 时视觉隐藏） */
  label: string;
  /** 视觉隐藏标签（屏幕阅读器仍可读）@default false */
  isLabelHidden?: boolean;
  /** 标签与输入框之间的描述文本 */
  description?: string;
  /** 选填标记（与 isRequired 互斥；同时设置时 isRequired 优先）@default false */
  isOptional?: boolean;
  /** 必填标记（与 isOptional 互斥）@default false */
  isRequired?: boolean;
  /** 禁用 @default false */
  isDisabled?: boolean;
  /** 只读：不置灰、仍在 tab 序、随表单提交，但不可编辑 @default false */
  isReadOnly?: boolean;
  /**
   * 禁用原因：与 isDisabled 同设时，输入框改用 aria-disabled + readOnly（保持键盘可聚焦），
   * 悬停/聚焦时在输入框上方显示该说明 tooltip。不要用外部 Tooltip 包裹禁用输入框。
   */
  disabledMessage?: string;
  /** 前置图标（JSX 元素，如 <Icon icon="mdi:magnify" />） */
  startIcon?: JSX.Element;
  /** 校验状态：着色边框 + 状态图标 + 可选消息框 */
  status?: TextInputStatus;
  /**
   * 状态消息排布：
   * - 'attached'：消息框紧贴输入框下方（带边框底色）
   * - 'detached'：消息框独立下沉（加大间距）
   * - 'tooltip'：不渲染消息框；状态图标变为可聚焦信息按钮，悬停/聚焦显示 tooltip
   * @default "attached"
   */
  statusVariant?: TextInputStatusVariant;
  /** 尺寸：sm=24px / md=32px / lg=40px 高 @default "md" */
  size?: TextInputSize;
  /** 受控值 */
  value: string;
  /** 值变化回调（受控；changeAction 可在 e.defaultPrevented 时被阻止） */
  onChange?: (value: string, e: InputEvent & { currentTarget: HTMLInputElement }) => void;
  /** 异步变更动作：pending 期间显示 spinner + aria-busy */
  changeAction?: (value: string, e: InputEvent & { currentTarget: HTMLInputElement }) => void | Promise<void>;
  /** 显式加载态（spinner + aria-busy）@default false */
  isLoading?: boolean;
  /** 占位文本 */
  placeholder?: string;
  /** 整个字段宽度：数字=px，字符串原样（如 "100%"）；label/控件/状态消息一起缩放对齐 */
  width?: number | string;
  /** 颜色变量覆盖（作用于字段根元素）：如 { "--ti-bg": "#fff", "--ti-error": "#e00" } */
  colorVars?: TextInputColorVars;
  /** 标签行尾部信息图标 tooltip（悬停/聚焦显示） */
  labelTooltip?: string;
  /** 有值时显示 ✕ 清除按钮：清空值并回焦输入框 @default false */
  hasClear?: boolean;
  /** 挂载时自动聚焦 @default false */
  hasAutoFocus?: boolean;
  /** 原生 name 属性（表单提交；禁用时不提交） */
  htmlName?: string;
  /** Enter 键回调 */
  onEnter?: () => void;
  /** 键盘事件（Enter 先触发 onEnter，再调用本回调） */
  onKeyDown?: (e: KeyboardEvent) => void;
  /** 原生 onInput（先于 onChange 触发；仅消费方需要原始事件时使用） */
  onInput?: (e: InputEvent & { currentTarget: HTMLInputElement }) => void;
  /** 输入框 DOM 引用 */
  ref?: (el: HTMLInputElement) => void;
  /** 内联样式（作用于输入容器） */
  style?: JSX.CSSProperties;
  /** StyleX 样式注入（作用于输入容器；最后合并，冲突时覆盖内部） */
  xstyle?: StyleXStyles;
  /** 外部 class（与内部 stylex 类名拼接，不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
}

const SPLIT_KEYS = [
  "type", "label", "isLabelHidden", "description", "isOptional", "isRequired",
  "isDisabled", "isReadOnly", "disabledMessage", "startIcon", "status", "statusVariant",
  "size", "value", "onChange", "changeAction", "isLoading", "placeholder", "width", "colorVars",
  "labelTooltip", "hasClear", "hasAutoFocus", "htmlName", "onEnter", "onKeyDown",
  "onInput", "ref", "style", "xstyle", "class", "className",
] as const;

/** 文本输入框（两站共享）：复刻 Astryx TextInput；surface 底 / surfaceStrong 边框 / onSurface 字 */
export function TextInput(props: TextInputProps) {
  const { t } = useI18n();
  const [local, rest] = splitProps(props, SPLIT_KEYS);
  // startIcon 用 children() 包装：lazy props 里的 JSX 在 Solid 1.9 hydration 下组件 key
  // 分配与 SSR 不一致（Hydration Mismatch）——children() 转为稳定 memo（同 Button）
  const startIconNode = children(() => local.startIcon);

  const id = createUniqueId();
  const labelId = createUniqueId();
  const descriptionId = createUniqueId();
  const statusMessageId = createUniqueId();
  const disabledTipId = createUniqueId();
  const labelTipId = createUniqueId();
  const statusTipId = createUniqueId();

  let inputEl: HTMLInputElement | undefined;

  const isDisabled = () => props.isDisabled === true;
  const isReadOnly = () => props.isReadOnly === true;
  const isSize = (s: TextInputSize) => (props.size ?? "md") === s;
  const statusType = () => props.status?.type ?? null;
  const isStatusType = (s: TextInputStatusType) => (props.status?.type ?? null) === s;
  const statusVariant = () => props.statusVariant ?? "attached";
  // StyleX 静态求值限制：stylex.props 条件必须是裸调用表达式（函数体内比较），
  // 不能写成 `statusVariant() === "detached"`——二元表达式会被编译期求值并因
  // 引用 props 参数而炸 Unsupported expression（同 button.tsx 约定）
  const isDetached = () => props.statusVariant === "detached";
  const isEffectivelyRequired = () => local.isRequired === true && local.isOptional !== true;
  const showsDisabledMessage = () => isDisabled() && local.disabledMessage != null;
  const statusMessage = () => local.status?.message ?? null;
  const statusMessageShown = () => statusMessage() != null && statusVariant() !== "tooltip";
  // attached 变体且显示状态消息：statusStack 铺与 banner 同款底色，banner 本体透明
  // stylex.props 条件必须是「单层裸调用表达式」：嵌套逻辑表达式（如 A() && B() && styles.x）
  // 会被编译期求值内联函数体，函数体内的可选链（local.status?.message）触发
  // Unsupported expression: OptionalMemberExpression。复合判断全部收进单层调用里
  const isStackTinted = () => statusMessageShown() && !isDetached();
  const stackTintError = () => isStackTinted() && isStatusType("error");
  const stackTintWarning = () => isStackTinted() && isStatusType("warning");
  const stackTintSuccess = () => isStackTinted() && isStatusType("success");
  const statusIconShown = () => local.status != null;
  const showClear = () => !!local.hasClear && local.value !== "" && !isDisabled() && !isReadOnly();

  // changeAction 异步变更：pending 期间显示 spinner + aria-busy
  const [pending, setPending] = createSignal(false);
  const isBusy = () => !!local.isLoading || pending();

  // 自绘 tooltip 显隐（禁用原因 / 标签信息 / 状态 tooltip 变体）
  const [disabledTipVisible, setDisabledTipVisible] = createSignal(false);
  const [labelTipVisible, setLabelTipVisible] = createSignal(false);
  const [statusTipVisible, setStatusTipVisible] = createSignal(false);

  const showDisabledTip = () => {
    if (showsDisabledMessage()) setDisabledTipVisible(true);
  };
  const hideDisabledTip = () => setDisabledTipVisible(false);
  const showLabelTip = () => setLabelTipVisible(true);
  const hideLabelTip = () => setLabelTipVisible(false);
  const showStatusTip = () => setStatusTipVisible(true);
  const hideStatusTip = () => setStatusTipVisible(false);

  // 点击容器空白处聚焦输入框（图标/内边距区域）；按钮（清除/状态）自行管理焦点
  const handleWrapperClick = (e: MouseEvent) => {
    if (isDisabled()) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    inputEl?.focus();
  };

  const handleInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    if (isDisabled() || isReadOnly()) return;
    const newValue = e.currentTarget.value;
    local.onInput?.(e);
    local.onChange?.(newValue, e);
    if (local.changeAction && !e.defaultPrevented) {
      setPending(true);
      Promise.resolve(local.changeAction(newValue, e))
        .catch(() => {
          // changeAction 拒绝：pending 已复位；错误由消费方自己的 Promise 链处理
        })
        .finally(() => setPending(false));
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") local.onEnter?.();
    local.onKeyDown?.(e);
  };

  // 清除按钮：清空值 + 回焦（与 Astryx 一致，事件参数为 null）
  const handleClear = () => {
    local.onChange?.(
      "",
      null as unknown as InputEvent & { currentTarget: HTMLInputElement },
    );
    inputEl?.focus();
  };

  const clearLabel = () => t("field.clear", { label: local.label });

  // 输入框 aria-describedby：描述 / 状态消息（非 tooltip 变体）/ 状态 tooltip / 禁用原因 tooltip
  const mergedDescribedBy = () => {
    const ids: string[] = [];
    if (local.description != null) ids.push(descriptionId);
    if (statusMessageShown()) ids.push(statusMessageId);
    if (statusVariant() === "tooltip" && statusMessage() != null) ids.push(statusTipId);
    if (showsDisabledMessage()) ids.push(disabledTipId);
    return ids.length ? ids.join(" ") : undefined;
  };

  const setInputRef = (el: HTMLInputElement) => {
    inputEl = el;
    local.ref?.(el);
  };

  // 输入容器样式（size/status/disabled/xstyle 条件合并）；外部 class 显式拼接（同 Button）
  const mergedWrapperAttrs = () => {
    const attrs = stylex.props(
      styles.wrapper,
      sizeStyles.md,
      isSize("sm") && sizeStyles.sm,
      isSize("lg") && sizeStyles.lg,
      isStatusType("error") && statusStyles.borderError,
      isStatusType("warning") && statusStyles.borderWarning,
      isStatusType("success") && statusStyles.borderSuccess,
      isDisabled() && styles.wrapperDisabled,
      isStackTinted() && styles.wrapperAttached,
      props.xstyle,
    );
    const external = local.class ?? local.className;
    if (external == null) return attrs;
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className };
  };

  // 根元素样式：width（整个字段宽度）+ colorVars（颜色变量；内联样式优先级最高，覆盖 stylex 类声明的默认值）
  const mergedRootStyle = (): (JSX.CSSProperties & TextInputColorVars) | undefined => {
    const w = local.width;
    const width = w == null ? undefined : typeof w === "number" ? `${w}px` : w;
    if (width == null && local.colorVars == null) return undefined;
    return {
      ...(width != null ? { width } : {}),
      ...(local.colorVars as Record<string, string> | undefined),
    } as JSX.CSSProperties & TextInputColorVars;
  };

  const statusIconNode = () => (
    <span
      {...stylex.props(
        styles.statusIconSlot,
        isStatusType("error") && statusStyles.iconError,
        isStatusType("warning") && statusStyles.iconWarning,
        isStatusType("success") && statusStyles.iconSuccess,
      )}
    >
      <Icon icon={STATUS_ICONS[statusType() as TextInputStatusType]} width={16} height={16} />
    </span>
  );

  const statusTooltipNode = () => (
    <button
      type="button"
      aria-label={statusMessage() ?? local.label}
      onMouseEnter={showStatusTip}
      onMouseLeave={hideStatusTip}
      onFocus={showStatusTip}
      onBlur={hideStatusTip}
      {...stylex.props(
        styles.clearButton,
        isStatusType("error") && statusStyles.iconError,
        isStatusType("warning") && statusStyles.iconWarning,
        isStatusType("success") && statusStyles.iconSuccess,
      )}
    >
      <Icon icon={STATUS_INFO_ICON} width={16} height={16} />
      <Tooltip isOpen={statusTipVisible() && statusMessage() != null} label={statusMessage() ?? undefined} id={statusTipId} />
    </button>
  );

  return (
    <div {...stylex.props(styles.root)} style={mergedRootStyle()}>
      <Show
        when={!local.isLabelHidden}
        fallback={
          <label for={id} id={labelId} {...stylex.props(styles.visuallyHidden)}>
            {local.label}
          </label>
        }
      >
        <div {...stylex.props(styles.labelRow)}>
          <label for={id} id={labelId} {...stylex.props(styles.labelText)}>
            {local.label}
            <Show when={isEffectivelyRequired()}>
              <span {...stylex.props(styles.requiredMark)} aria-hidden="true"> *</span>
            </Show>
          </label>
          <Show when={local.isOptional === true}>
            <span {...stylex.props(styles.optionalMark)}>{t("field.optional")}</span>
          </Show>
          <Show when={local.labelTooltip != null}>
            <button
              type="button"
              aria-label={local.labelTooltip}
              onMouseEnter={showLabelTip}
              onMouseLeave={hideLabelTip}
              onFocus={showLabelTip}
              onBlur={hideLabelTip}
              {...stylex.props(styles.clearButton)}
            >
              <Icon icon={STATUS_INFO_ICON} width={14} height={14} />
              <Tooltip isOpen={labelTipVisible()} label={local.labelTooltip} id={labelTipId} />
            </button>
          </Show>
        </div>
      </Show>

      <Show when={local.description != null}>
        <p id={descriptionId} {...stylex.props(styles.description)}>
          {local.description}
        </p>
      </Show>

      {/* attached：输入框 + banner 整个区块共用一层 banner 底色（statusStack）——
          输入框容器与 banner 均透明露出同色，形成一整块圆角底色，无缝隙 */}
      <div
        {...stylex.props(
          styles.statusStack,
          stackTintError() && statusStyles.stackError,
          stackTintWarning() && statusStyles.stackWarning,
          stackTintSuccess() && statusStyles.stackSuccess,
        )}
      >
      <div {...stylex.props(styles.wrapperAnchor)}>
      <div
        onClick={handleWrapperClick}
        onFocusIn={showDisabledTip}
        onFocusOut={hideDisabledTip}
        onMouseEnter={showDisabledTip}
        onMouseLeave={hideDisabledTip}
        style={local.style}
        {...mergedWrapperAttrs()}
      >
        <Show when={startIconNode() != null}>
          <span {...stylex.props(styles.startIconSlot)}>{startIconNode()}</span>
        </Show>
        <input
          {...rest}
          ref={setInputRef}
          id={id}
          type={local.type ?? "text"}
          value={local.value}
          name={isDisabled() ? undefined : local.htmlName}
          placeholder={local.placeholder}
          autofocus={local.hasAutoFocus || undefined}
          data-autofocus={local.hasAutoFocus || undefined}
          disabled={isDisabled() && !showsDisabledMessage() || undefined}
          aria-disabled={showsDisabledMessage() ? "true" : undefined}
          readOnly={isReadOnly() || showsDisabledMessage() || undefined}
          aria-required={isEffectivelyRequired() ? "true" : undefined}
          aria-invalid={statusType() === "error" ? "true" : undefined}
          aria-busy={isBusy() || undefined}
          aria-labelledby={labelId}
          aria-describedby={mergedDescribedBy()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          {...stylex.props(styles.input, isDisabled() && styles.inputDisabled)}
        />
        <Show when={showClear()}>
          <button
            type="button"
            aria-label={clearLabel()}
            onClick={handleClear}
            {...stylex.props(styles.clearButton)}
          >
            <Icon icon="mdi:close" width={14} height={14} />
          </button>
        </Show>
        <Show when={isBusy()}>
          <Spinner size={16} shade="inherit" />
        </Show>
        <Show when={statusIconShown()}>
          <Show when={statusVariant() === "tooltip"} fallback={statusIconNode()}>
            {statusTooltipNode()}
          </Show>
        </Show>
      </div>
      {/* 禁用原因 tooltip 放 opacity 容器外：禁用态容器 opacity 不影响气泡（统一 Tooltip） */}
      <Tooltip isOpen={showsDisabledMessage() && disabledTipVisible()} label={local.disabledMessage} id={disabledTipId} />
      </div>

      <Show when={statusMessageShown()}>
        <div
          id={statusMessageId}
          {...stylex.props(
            styles.messageBox,
            isDetached() && styles.messageDetached,
            isStatusType("error") && statusStyles.messageError,
            isStatusType("warning") && statusStyles.messageWarning,
            isStatusType("success") && statusStyles.messageSuccess,
            // attached：底色由 statusStack 承担，banner 本体透明，避免二次染色
            isStackTinted() && styles.messageAttached,
          )}
        >
          {statusMessage()}
        </div>
      </Show>
      </div>

    </div>
  );
}
