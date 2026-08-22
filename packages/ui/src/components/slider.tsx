import * as stylex from "@stylexjs/stylex";
import {
  For,
  Show,
  createMemo,
  createSignal,
  createUniqueId,
  splitProps,
  type JSX,
} from "solid-js";
import { type StyleXStyles } from "@stylexjs/stylex";
import { colors, dimensions, durations, easings, fontfamilies } from "../theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { Tooltip } from "./tooltip";

/**
 * Slider（复刻 Astryx Slider：https://astryx.atmeta.com/components/Slider，
 * 接口与行为对齐参考实现 github.com/facebook/astryx，MIT）
 * - 受控组件：value 必填（number 单值 / [number, number] 范围双 thumb），
 *   onChange 拖动/键盘中回调，onChangeEnd 拖动结束（pointerup/pointercancel 或键盘）回调
 * - 键盘（APG slider pattern）：ArrowLeft/Right/Up/Down ±step，PageUp/PageDown ±step×10，
 *   Home/End 到 min/max；keydown 后同步 fire onChangeEnd（携带精确更新后的值）
 * - pointer：整条轨道可点击跳转（选中最近 thumb 并聚焦），拖拽走 pointer capture；
 *   点击 mark（data-mark-value）直接吸附该 mark 值，避免宽 label 的 off-by-one
 * - 行程内缩半个 thumb（THUMB_INSET）：thumb 在 min/max 不越出组件盒（原生 range 几何，
 *   Astryx #5050），fill/marks 走同一映射，travelFraction 逆映射保证按住 thumb 不跳值
 * - 值 clamp 到 [min, max] 且按 min/step 十进制精度取整（消除二进制浮点误差，
 *   0.1 步长得到 0.3 而非 0.30000000000000004）
 * - 范围模式：minStepsBetweenThumbs 限制双 thumb 最小间隔；aria-valuemin/max 随兄弟
 *   thumb 收窄（WCAG 1.3.2），与实际移动 clamp 一致
 * - 值显示 valueDisplay：tooltip（自绘气泡，hover/focus/拖拽中常显）/ text（行尾文本）/
 *   none；formatValue 用于显示与 aria-valuetext
 * - disabledMessage：禁用原因 tooltip（hover/focus 显示），thumb 保持可聚焦
 *   （aria-disabled），值变更仍被阻止；勿用外部 Tooltip 包裹禁用控件（禁用控件吞 hover 事件）
 * - htmlName：渲染隐藏 input 携带当前值参与表单提交（范围模式两个，禁用时 disabled 排除）
 * - 必填/选填：role="slider" 不支持 aria-required（WAI-ARIA 1.2），经 aria-describedby
 *   指向视觉隐藏的必填 span + 标签可见标记传达（isOptional 优先于 isRequired）
 * - RTL：位置走 logical properties（insetInlineStart 等），thumb/mark 居中 transform 经
 *   :is([dir="rtl"] *) 翻转；pointer→值映射按轨道 computed direction 测量
 * - 垂直方向：bottom=min、top=max；轨道容器 20×160
 * - 变量全部使用 theme.stylex 非废弃 tokens（colors/dimensions/durations/easings/fontfamilies），
 *   动画尊重 prefers-reduced-motion
 */

const TRACK_SIZE = 4;
const THUMB_SIZE = 20;
const THUMB_INSET = THUMB_SIZE / 2;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type SliderOrientation = "horizontal" | "vertical";
export type SliderValueDisplay = "tooltip" | "text" | "none";
export type SliderStatusType = "warning" | "error" | "success";

/** 校验状态（type 决定颜色，message 渲染于控件下方并接入 aria-describedby） */
export interface SliderStatus {
  type: SliderStatusType;
  message?: string;
}

/** 刻度 mark：value 为取值（min~max），点击时吸附；label 可选渲染于刻度旁 */
export interface SliderMark {
  value: number;
  label?: string;
}

export interface SliderBaseProps {
  /** 标签文本（始终渲染，isLabelHidden 时仅对屏幕阅读器可见） */
  label: string;
  /** 是否视觉隐藏标签（仍可访问）@default false */
  isLabelHidden?: boolean;
  /** 标签下方的说明文本 */
  description?: string;
  /** 是否禁用 @default false */
  isDisabled?: boolean;
  /** 禁用原因：与 isDisabled 同用时显示自绘 tooltip（hover/focus），thumb 经 aria-disabled 保持可聚焦 */
  disabledMessage?: string;
  /** 是否选填 @default false */
  isOptional?: boolean;
  /** 是否必填 @default false */
  isRequired?: boolean;
  /** 校验状态指示 */
  status?: SliderStatus;
  /** 标签旁信息图标（ⓘ）的 tooltip 文本 */
  labelTooltip?: string;
  /** 最小值 @default 0 */
  min?: number;
  /** 最大值 @default 100 */
  max?: number;
  /** 步长 @default 1 */
  step?: number;
  /** 方向 @default "horizontal" */
  orientation?: SliderOrientation;
  /** 值格式化函数（显示与 aria-valuetext 共用） */
  formatValue?: (value: number) => string;
  /** 当前值显示方式 @default "tooltip" */
  valueDisplay?: SliderValueDisplay;
  /** 刻度 mark 列表 */
  marks?: SliderMark[];
  /** 表单提交 name：渲染隐藏 input 携带当前值（范围模式两个） */
  htmlName?: string;
  /** 字段宽度：数字=px、字符串原样（如 "100%"）；作用于整个字段（标签+控件+状态） */
  width?: number | string;
  /** StyleX 样式（stylex.create 产物），同名属性覆盖内部 */
  xstyle?: StyleXStyles;
  /** 外部 class：与内部 stylex 类名拼接（不覆盖） */
  class?: string;
  /** 外部 class（Solid 别名，与 class 等价） */
  className?: string;
  /** 内联样式（与 width 合并，width 优先） */
  style?: string | JSX.CSSProperties;
}

export interface SliderSingleProps extends SliderBaseProps {
  /** 当前值（单 thumb 模式） */
  value: number;
  /** 拖动/键盘过程中值变化回调 */
  onChange?: (value: number) => void;
  /** 拖动结束（pointer up 或键盘）回调 */
  onChangeEnd?: (value: number) => void;
}

export interface SliderRangeProps extends SliderBaseProps {
  /** 当前值（范围模式：[min 值, max 值]） */
  value: [number, number];
  /** 拖动/键盘过程中值变化回调 */
  onChange?: (value: [number, number]) => void;
  /** 拖动结束（pointer up 或键盘）回调 */
  onChangeEnd?: (value: [number, number]) => void;
  /** 双 thumb 最小间隔（步数）@default 0 */
  minStepsBetweenThumbs?: number;
}

export type SliderProps = SliderSingleProps | SliderRangeProps;

/** 内部统一视图：union 两分支字段取并集，便于 splitProps 与取值 */
type SliderInternalProps = SliderBaseProps & SliderSingleProps & SliderRangeProps;

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

/** 数值的十进制精度（含科学计数法，如 1e-7 → 7），用于步长算术后去除浮点误差 */
function getDecimalPrecision(num: number): number {
  if (Math.abs(num) < 1) {
    const parts = num.toExponential().split("e-");
    if (parts.length === 2) {
      const mantissaDecimals = parts[0].split(".")[1]?.length ?? 0;
      return mantissaDecimals + parseInt(parts[1], 10);
    }
  }
  const decimalPart = String(num).split(".")[1];
  return decimalPart ? decimalPart.length : 0;
}

/** 吸附到 min + n×step，并按 min/step 精度取整消除浮点误差 */
function snapToStep(val: number, min: number, step: number): number {
  if (step <= 0) {
    return val;
  }
  const steps = Math.round((val - min) / step);
  const snapped = min + steps * step;
  const precision = Math.min(
    Math.max(getDecimalPrecision(min), getDecimalPrecision(step)),
    20, // toFixed() 超过 20 位会抛错
  );
  return Number(snapped.toFixed(precision));
}

function getPercent(val: number, min: number, max: number): number {
  if (max === min) {
    return 0;
  }
  return ((val - min) / (max - min)) * 100;
}

function cssLength(percent: number, px: number): string {
  // 百分比与 px 都做取整，避免二进制浮点误差泄漏进 DOM（calc(33% + 3.3999999999999995px)）
  const round = (n: number, digits: number): number => {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  };
  return `calc(${round(percent, 6)}% + ${round(px, 2)}px)`;
}

/** 行程内缩映射：百分比 → inset 位置（行程两端各内缩半个 thumb） */
function insetPosition(percent: number): string {
  return cssLength(percent, THUMB_INSET - (percent / 100) * THUMB_SIZE);
}

/** 两百分比之间的跨度（内缩量相消） */
function insetSpan(fromPercent: number, toPercent: number): string {
  const delta = toPercent - fromPercent;
  return cssLength(delta, -(delta / 100) * THUMB_SIZE);
}

/** insetPosition 的逆映射：盒内偏移 → 0~1 行程比例（pointer→值用） */
function travelFraction(offset: number, size: number): number {
  const travel = size - THUMB_SIZE;
  if (travel > 0) {
    return (offset - THUMB_INSET) / travel;
  }
  // 比 thumb 还窄，没有行程可映射：退回原始比例避免除零
  return size > 0 ? offset / size : 0;
}

// ---------------------------------------------------------------------------
// 样式
// ---------------------------------------------------------------------------

const styles = stylex.create({
  // 注意：字段容器默认不加外边距（Slider 常内联使用，如播放条）；需要间距时
  // 通过 xstyle 的 margin* 自行添加
  labelRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing1,
    marginBottom: dimensions.spacing1,
  },
  label: {
    color: colors.neutral,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeSm,
  },
  labelHidden: {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  requiredMark: {
    color: colors.danger,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeXs,
    fontWeight: dimensions.fontWeightBold,
  },
  optionalMark: {
    color: colors.neutralWeak,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSize2xs,
  },
  infoIcon: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: colors.neutralWeak,
    cursor: "help",
    borderRadius: dimensions.radiusFull,
    outline: "none",
    ":focus-visible": {
      outline: `2px solid ${colors.primary}`,
      outlineOffset: "2px",
    },
  },
  // 信息气泡附加样式（统一 Tooltip placement="bottom" + 本样式：限宽/换行/阴影）
  infoBubbleExtras: {
    maxWidth: 240,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
    whiteSpace: "normal",
  },
  description: {
    color: colors.neutralWeak,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeXs,
    marginBottom: dimensions.spacing1,
  },
  status: {
    marginTop: dimensions.spacing1,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeXs,
  },
  statusError: { color: colors.danger },
  statusWarning: { color: colors.warning },
  statusSuccess: { color: colors.success },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing2,
  },
  trackContainer: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexGrow: 1,
    touchAction: "none",
    userSelect: "none",
    isolation: "isolate",
  },
  trackContainerHorizontal: {
    height: THUMB_SIZE,
    width: "100%",
    cursor: "pointer",
  },
  trackContainerVertical: {
    width: THUMB_SIZE,
    height: 160,
    flexDirection: "column",
    justifyContent: "center",
    cursor: "pointer",
  },
  trackContainerDisabled: {
    cursor: "not-allowed",
  },
  // 禁用态淡化层：只包裹轨道/填充/刻度/thumb 等视觉元素（绝对定位，static 零尺寸不影响布局），
  // 禁用原因 tooltip 留在层外——opacity 不再把气泡一起淡化（统一 Tooltip）
  trackOpacity: {
    opacity: 0.5,
  },
  // 主题色变量（默认 primary / surfaceWeak）：经根容器 --slider-accent、
  // --slider-track 下发，消费方用 xstyle 覆盖即可定制进度条/轨道颜色
  accentVars: {
    "--slider-accent": colors.primary,
    "--slider-track": colors.primaryWeak,
  },
  track: {
    position: "absolute",
    backgroundColor: `color-mix(in srgb, var(--slider-track) 60%, transparent)`,
    borderRadius: dimensions.radiusFull,
  },
  trackHorizontal: {
    insetInlineStart: 0,
    insetInlineEnd: 0,
    height: TRACK_SIZE,
    top: "50%",
    transform: "translateY(-50%)",
  },
  trackVertical: {
    top: 0,
    bottom: 0,
    width: TRACK_SIZE,
    left: "50%",
    transform: "translateX(-50%)",
  },
  filledTrack: {
    position: "absolute",
    backgroundColor: "var(--slider-accent)",
    borderRadius: dimensions.radiusFull,
  },
  filledTrackHorizontal: {
    height: TRACK_SIZE,
    top: "50%",
    transform: "translateY(-50%)",
  },
  filledTrackVertical: {
    width: TRACK_SIZE,
    left: "50%",
    transform: "translateX(-50%)",
  },
  thumb: {
    position: "absolute",
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "var(--slider-accent)",
    // 水平方向：insetInlineStart 在 RTL 下从右侧解析，居中 transform 是物理变换，
    // 需在 RTL 下翻转 X 方向保持居中在值点上（Astryx 同款）
    transform: {
      default: "translate(-50%, -50%)",
      ':is([dir="rtl"] *)': "translate(50%, -50%)",
    },
    transitionProperty: "background-color, box-shadow",
    transitionDuration: {
      default: durations.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: easings.easeInOut,
    outline: "none",
    cursor: "grab",
    zIndex: 1,
    ":active": { cursor: "grabbing" },
  },
  thumbHover: {
    backgroundColor: {
      default: "var(--slider-accent)",
      ":hover": {
        "@media (hover: hover)": `color-mix(in srgb, var(--slider-accent), ${colors.ink} 10%)`,
      },
    },
  },
  thumbDisabled: {
    backgroundColor: colors.primaryStrong,
    cursor: "not-allowed",
  },
  focusVisible: {
    outline: { default: null, ":focus-visible": "2px solid var(--slider-accent)" },
    outlineOffset: { default: "0", ":focus-visible": "2px" },
  },
  textValue: {
    flexShrink: 0,
    color: colors.neutral,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSizeSm,
    whiteSpace: "nowrap",
  },
  marksContainer: {
    position: "absolute",
  },
  marksContainerHorizontal: {
    insetInlineStart: 0,
    insetInlineEnd: 0,
    top: "50%",
  },
  marksContainerVertical: {
    top: 0,
    bottom: 0,
    insetInlineStart: "50%",
  },
  mark: {
    position: "absolute",
    backgroundColor: colors.neutralWeak,
    borderRadius: dimensions.radiusFull,
  },
  markHorizontal: {
    width: 2,
    height: 8,
    transform: {
      default: "translate(-50%, -50%)",
      ':is([dir="rtl"] *)': "translate(50%, -50%)",
    },
  },
  markVertical: {
    height: 2,
    width: 8,
    transform: "translate(-50%, 50%)",
  },
  markLabel: {
    position: "absolute",
    color: colors.neutralWeak,
    fontFamily: fontfamilies.body,
    fontSize: dimensions.fontSize2xs,
    whiteSpace: "nowrap",
  },
  markLabelHorizontal: {
    top: THUMB_SIZE / 2 + 4,
    transform: {
      default: "translateX(-50%)",
      ':is([dir="rtl"] *)': "translateX(50%)",
    },
  },
  markLabelVertical: {
    insetInlineStart: THUMB_SIZE / 2 + 4,
    transform: "translateY(-50%)",
  },
});

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * 滑块：单值或范围选择。受控组件，value 必填。
 *
 * @example
 * <Slider label="音量" value={50} onChange={setVolume} />
 * <Slider label="价格区间" value={[20, 80]} onChange={setRange} />
 */
export function Slider(props: SliderProps) {
  const { t } = useI18n();
  const p = props as SliderInternalProps;
  const [local, rest] = splitProps(p, [
    "label",
    "isLabelHidden",
    "description",
    "isDisabled",
    "disabledMessage",
    "isOptional",
    "isRequired",
    "status",
    "labelTooltip",
    "min",
    "max",
    "step",
    "orientation",
    "formatValue",
    "valueDisplay",
    "marks",
    "htmlName",
    "width",
    "xstyle",
    "class",
    "className",
    "style",
    "value",
    "onChange",
    "onChangeEnd",
    "minStepsBetweenThumbs",
  ]);

  // 取值判断统一包成调用表达式（StyleX 限制：stylex.props 条件必须是调用表达式
  // 或直接引用 props，组合/一元表达式在编译期静态求值时炸 Unsupported expression）
  const isRange = () => Array.isArray(local.value);
  const isHorizontal = () => (local.orientation ?? "horizontal") === "horizontal";
  const isVertical = () => !isHorizontal();
  const isDisabled = () => local.isDisabled ?? false;
  const isEnabled = () => !isDisabled();
  const isLabelHidden = () => local.isLabelHidden ?? false;
  const min = () => local.min ?? 0;
  const max = () => local.max ?? 100;
  const step = () => local.step ?? 1;
  const minSteps = () => (isRange() ? local.minStepsBetweenThumbs ?? 0 : 0);
  const conveysRequired = () => !!local.isRequired && !local.isOptional;
  const showsDisabledMessage = () => isDisabled() && !!local.disabledMessage;
  const valueDisplay = () => local.valueDisplay ?? "tooltip";

  // 当前值（clamp 到 [min, max]；value 缺省防御性回退 min）
  const values = createMemo<number[]>(() => {
    const current = isRange()
      ? (local.value as [number, number])
      : [local.value as number];
    return current.map((v) => clamp(v == null ? min() : v, min(), max()));
  });

  const [dragging, setDragging] = createSignal<number | null>(null);
  const [bubbleIndex, setBubbleIndex] = createSignal<number | null>(null);
  const [labelTooltipOpen, setLabelTooltipOpen] = createSignal(false);
  const [disabledMsgOpen, setDisabledMsgOpen] = createSignal(false);

  const labelId = createUniqueId();
  const descriptionId = createUniqueId();
  const statusId = createUniqueId();
  const requiredId = createUniqueId();
  const thumbId = createUniqueId();
  const disabledMsgId = createUniqueId();

  let trackEl: HTMLDivElement | null = null;

  const describedBy = () => {
    const parts: string[] = [];
    if (local.description) parts.push(descriptionId);
    if (local.status?.message) parts.push(statusId);
    if (conveysRequired()) parts.push(requiredId);
    if (showsDisabledMessage()) parts.push(disabledMsgId);
    return parts.length > 0 ? parts.join(" ") : undefined;
  };

  const displayValue = (val: number): string =>
    local.formatValue ? local.formatValue(val) : String(val);

  const getValueFromPosition = (clientX: number, clientY: number): number => {
    const track = trackEl;
    if (!track) return min();
    const rect = track.getBoundingClientRect();
    let percent: number;
    if (isHorizontal()) {
      // RTL 下 inline-start（值=min）在右侧：按轨道 computed direction 从右测量
      const dir =
        typeof getComputedStyle === "function"
          ? getComputedStyle(track).direction
          : "ltr";
      percent = travelFraction(
        dir === "rtl" ? rect.right - clientX : clientX - rect.left,
        rect.width,
      );
    } else {
      // 垂直：bottom=min、top=max
      percent = 1 - travelFraction(clientY - rect.top, rect.height);
    }
    percent = clamp(percent, 0, 1);
    const raw = min() + percent * (max() - min());
    return clamp(snapToStep(raw, min(), step()), min(), max());
  };

  const getClosestThumb = (newValue: number): number => {
    if (!isRange()) return 0;
    const [v0, v1] = values();
    // 距离相等时偏向较低 thumb
    return Math.abs(newValue - v0) <= Math.abs(newValue - v1) ? 0 : 1;
  };

  const updateValue = (thumbIndex: number, newVal: number): void => {
    if (isDisabled()) return;
    const clamped = clamp(snapToStep(newVal, min(), step()), min(), max());
    if (isRange()) {
      const current = [...values()] as [number, number];
      current[thumbIndex] = clamped;
      // 强制 minStepsBetweenThumbs 最小间隔，再 clamp 到 [min, max]
      const minGap = minSteps() * step();
      if (thumbIndex === 0) {
        current[0] = Math.min(current[0], current[1] - minGap);
      } else {
        current[1] = Math.max(current[1], current[0] + minGap);
      }
      current[0] = clamp(current[0], min(), max());
      current[1] = clamp(current[1], min(), max());
      (local.onChange as SliderRangeProps["onChange"])?.(current);
    } else {
      (local.onChange as SliderSingleProps["onChange"])?.(clamped);
    }
  };

  const fireChangeEnd = (finalValues?: number[]): void => {
    const current = finalValues ?? values();
    const cb = local.onChangeEnd;
    if (isRange()) {
      (cb as SliderRangeProps["onChangeEnd"])?.(current as [number, number]);
    } else {
      (cb as SliderSingleProps["onChangeEnd"])?.(current[0]);
    }
  };

  // ---- pointer ----
  const handlePointerDown = (e: PointerEvent) => {
    if (isDisabled()) return;
    e.preventDefault();
    // 点击 mark 元素时吸附到该 mark 值（宽 label 如 "100" 时避免 off-by-one）
    const markEl = (e.target as HTMLElement).closest?.("[data-mark-value]");
    const newVal = markEl
      ? Number(markEl.getAttribute("data-mark-value"))
      : getValueFromPosition(e.clientX, e.clientY);
    const thumbIndex = getClosestThumb(newVal);
    setDragging(thumbIndex);
    updateValue(thumbIndex, newVal);
    // 聚焦最近 thumb
    const thumbs = trackEl?.querySelectorAll<HTMLElement>('[role="slider"]');
    thumbs?.[thumbIndex]?.focus();
    const current = e.currentTarget as HTMLDivElement;
    if (typeof current.setPointerCapture === "function") {
      current.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (dragging() === null || isDisabled()) return;
    updateValue(dragging() as number, getValueFromPosition(e.clientX, e.clientY));
  };

  const handlePointerUp = () => {
    if (dragging() !== null) {
      setDragging(null);
      fireChangeEnd();
    }
  };

  // ---- keyboard（APG slider pattern）----
  const handleKeyDown = (thumbIndex: number, e: KeyboardEvent) => {
    if (isDisabled()) return;
    const currentVal = values()[thumbIndex];
    let newVal: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        newVal = currentVal + step();
        break;
      case "ArrowLeft":
      case "ArrowDown":
        newVal = currentVal - step();
        break;
      case "PageUp":
        newVal = currentVal + step() * 10;
        break;
      case "PageDown":
        newVal = currentVal - step() * 10;
        break;
      case "Home":
        newVal = min();
        break;
      case "End":
        newVal = max();
        break;
      default:
        return;
    }
    e.preventDefault();
    const clamped = clamp(snapToStep(newVal, min(), step()), min(), max());
    updateValue(thumbIndex, newVal);
    // 计算精确更新后的值，让 onChangeEnd 在状态批处理前就拿到正确结果
    let final: number[];
    if (isRange()) {
      const next = [...values()] as [number, number];
      next[thumbIndex] = clamped;
      const minGap = minSteps() * step();
      if (thumbIndex === 0) {
        next[0] = Math.min(next[0], next[1] - minGap);
      } else {
        next[1] = Math.max(next[1], next[0] + minGap);
      }
      next[0] = clamp(next[0], min(), max());
      next[1] = clamp(next[1], min(), max());
      final = next;
    } else {
      final = [clamped];
    }
    fireChangeEnd(final);
  };

  // ---- 渲染 ----
  const filledStyle = createMemo<JSX.CSSProperties>(() => {
    if (isRange()) {
      const [v0, v1] = values();
      const p0 = getPercent(v0, min(), max());
      const p1 = getPercent(v1, min(), max());
      if (isHorizontal()) {
        return { "inset-inline-start": insetPosition(p0), width: insetSpan(p0, p1) };
      }
      return { bottom: insetPosition(p0), height: insetSpan(p0, p1) };
    }
    const p = getPercent(values()[0], min(), max());
    if (isHorizontal()) {
      return { "inset-inline-start": "0%", width: insetPosition(p) };
    }
    return { bottom: "0%", height: insetPosition(p) };
  });

  const renderThumb = (thumbIndex: number) => {
    const val = values()[thumbIndex];
    const percent = getPercent(val, min(), max());
    // 水平：top:50% + 基础 transform translate(-50%,-50%) 让 thumb 圆心与
    // 轨道/填充条中心（top:50% + translateY(-50%)）对齐；垂直：bottom 定位值点
    const positionStyle: JSX.CSSProperties = isHorizontal()
      ? { "inset-inline-start": insetPosition(percent), top: "50%" }
      : { bottom: insetPosition(percent), left: "50%" };

    // 范围模式：每个 thumb 用短名，与组标签（aria-labelledby）组合成完整可访问名
    const thumbLabel = isRange()
      ? thumbIndex === 0
        ? "Minimum value"
        : "Maximum value"
      : undefined;

    // ARIA 边界与 updateValue 的实际移动 clamp 一致
    const minGap = minSteps() * step();
    const ariaValueMin =
      isRange() && thumbIndex === 1
        ? clamp(values()[0] + minGap, min(), max())
        : min();
    const ariaValueMax =
      isRange() && thumbIndex === 0
        ? clamp(values()[1] - minGap, min(), max())
        : max();

    const useValueTooltip = () =>
      valueDisplay() === "tooltip" && !showsDisabledMessage();
    const bubbleVisible = () =>
      bubbleIndex() === thumbIndex || dragging() === thumbIndex;

    return (
      <div
        id={!isRange() ? thumbId : undefined}
        role="slider"
        tabIndex={isDisabled() && !showsDisabledMessage() ? -1 : 0}
        aria-valuemin={ariaValueMin}
        aria-valuemax={ariaValueMax}
        aria-valuenow={val}
        aria-valuetext={local.formatValue ? local.formatValue(val) : undefined}
        aria-orientation={local.orientation ?? "horizontal"}
        aria-disabled={isDisabled() || undefined}
        aria-invalid={local.status?.type === "error" ? true : undefined}
        aria-label={thumbLabel}
        aria-labelledby={!isRange() ? labelId : undefined}
        aria-describedby={describedBy()}
        onKeyDown={(e) => handleKeyDown(thumbIndex, e)}
        onMouseEnter={() => setBubbleIndex(thumbIndex)}
        onMouseLeave={() =>
          setBubbleIndex((b) => (b === thumbIndex ? null : b))
        }
        onFocus={() => setBubbleIndex(thumbIndex)}
        onBlur={() => setBubbleIndex((b) => (b === thumbIndex ? null : b))}
        {...stylex.props(
          styles.thumb,
          isEnabled() && styles.thumbHover,
          isEnabled() && styles.focusVisible,
          isDisabled() && styles.thumbDisabled,
        )}
        style={positionStyle}
      >
        <Tooltip
          isOpen={useValueTooltip() && bubbleVisible()}
          label={displayValue(val)}
          placement={isVertical() ? "end" : "top"}
        />
      </div>
    );
  };

  // 外部 class/className 不能走 rest 透传（后 spread 的 class 会整体覆盖内部
  // stylex 类名），必须显式拼接；xstyle 放 stylex.props 末尾以覆盖同名内部属性
  const rootAttrs = () => {
    const attrs = stylex.props(styles.accentVars, local.xstyle);
    const external = local.class ?? local.className;
    if (external == null) {
      return { ...attrs, ...rest };
    }
    const className = attrs.className ? `${attrs.className} ${external}` : external;
    return { ...attrs, className, ...rest };
  };

  const mergedStyle = (): JSX.CSSProperties | string | undefined => {
    const w = local.width;
    const width = w == null ? undefined : typeof w === "number" ? `${w}px` : w;
    if (width == null) return local.style;
    const base =
      typeof local.style === "object" ? (local.style as JSX.CSSProperties) : {};
    return { ...base, width };
  };

  const statusStyle = () =>
    local.status?.type === "error"
      ? styles.statusError
      : local.status?.type === "warning"
        ? styles.statusWarning
        : styles.statusSuccess;

  return (
    <div {...rootAttrs()} style={mergedStyle()}>
      {/* isLabelHidden：不渲染 label 行（空行 + marginBottom 会在控件上方撑出空隙），
          隐藏 label 独立渲染以维持 aria-labelledby 关联与可访问名 */}
      <Show when={!isLabelHidden()}>
        <div {...stylex.props(styles.labelRow)}>
          <Show when={conveysRequired()}>
            <span aria-hidden="true" {...stylex.props(styles.requiredMark)}>
              *
            </span>
          </Show>
          <label
            id={labelId}
            for={isRange() ? undefined : thumbId}
            {...stylex.props(styles.label)}
          >
            {local.label}
          </label>
          <Show when={local.isOptional && !local.isRequired}>
            <span aria-hidden="true" {...stylex.props(styles.optionalMark)}>
              {t("field.optional")}
            </span>
          </Show>
          <Show when={local.labelTooltip != null}>
            <span
              tabIndex={0}
              role="img"
              aria-label={local.labelTooltip}
              onMouseEnter={() => setLabelTooltipOpen(true)}
              onMouseLeave={() => setLabelTooltipOpen(false)}
              onFocus={() => setLabelTooltipOpen(true)}
              onBlur={() => setLabelTooltipOpen(false)}
              {...stylex.props(styles.infoIcon)}
            >
              <svg
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 7.25v3.25" stroke-linecap="round" />
                <path d="M8 4.75v.01" stroke-linecap="round" />
              </svg>
            </span>
            <Tooltip
              isOpen={labelTooltipOpen()}
              label={local.labelTooltip}
              placement="bottom"
              xstyle={styles.infoBubbleExtras}
            />
          </Show>
        </div>
      </Show>
      <Show when={isLabelHidden()}>
        <label id={labelId} {...stylex.props(styles.labelHidden)}>
          {local.label}
        </label>
      </Show>

      <Show when={local.description != null}>
        <div id={descriptionId} {...stylex.props(styles.description)}>
          {local.description}
        </div>
      </Show>

      <div {...stylex.props(styles.sliderRow)}>
        {/* 表单提交隐藏 input（范围模式两个；禁用时 disabled 排除出 FormData） */}
        <Show when={local.htmlName != null}>
          <For each={values()}>
            {(v) => (
              <input
                type="hidden"
                name={local.htmlName}
                value={String(v)}
                disabled={isDisabled() || undefined}
              />
            )}
          </For>
        </Show>

        <div
          ref={(el) => {
            trackEl = el;
          }}
          role={isRange() ? "group" : undefined}
          aria-labelledby={isRange() ? labelId : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseEnter={() => setDisabledMsgOpen(true)}
          onMouseLeave={() => setDisabledMsgOpen(false)}
          onFocusIn={() => setDisabledMsgOpen(true)}
          onFocusOut={() => setDisabledMsgOpen(false)}
          {...stylex.props(
            styles.trackContainer,
            isHorizontal() && styles.trackContainerHorizontal,
            isVertical() && styles.trackContainerVertical,
            isDisabled() && styles.trackContainerDisabled,
          )}
        >
          <div {...stylex.props(isDisabled() && styles.trackOpacity)}>
          {/* 背景轨道 */}
          <div
            aria-hidden="true"
            {...stylex.props(
              styles.track,
              isHorizontal() ? styles.trackHorizontal : styles.trackVertical,
            )}
          />
          {/* 已填充轨道（终点在 thumb 圆心，与 thumb 同一 inset 映射） */}
          <div
            aria-hidden="true"
            {...stylex.props(
              styles.filledTrack,
              isHorizontal()
                ? styles.filledTrackHorizontal
                : styles.filledTrackVertical,
            )}
            style={filledStyle()}
          />

          {/* 刻度 marks */}
          <Show when={local.marks != null && local.marks.length > 0}>
            <div
              aria-hidden="true"
              {...stylex.props(
                styles.marksContainer,
                isHorizontal()
                  ? styles.marksContainerHorizontal
                  : styles.marksContainerVertical,
              )}
            >
              <For each={local.marks}>
                {(mark) => {
                  const percent = getPercent(mark.value, min(), max());
                  const markPos: JSX.CSSProperties = isHorizontal()
                    ? { "inset-inline-start": insetPosition(percent) }
                    : { bottom: insetPosition(percent) };
                  return (
                    <div>
                      <div
                        data-mark-value={mark.value}
                        {...stylex.props(
                          styles.mark,
                          isHorizontal() ? styles.markHorizontal : styles.markVertical,
                        )}
                        style={markPos}
                      />
                      <Show when={mark.label != null}>
                        <span
                          data-mark-value={mark.value}
                          {...stylex.props(
                            styles.markLabel,
                            isHorizontal()
                              ? styles.markLabelHorizontal
                              : styles.markLabelVertical,
                          )}
                          style={markPos}
                        >
                          {mark.label}
                        </span>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>

          {/* thumbs */}
          <For each={values()}>{(_, i) => renderThumb(i())}</For>
          </div>

          {/* 禁用原因 tooltip（hover/focus 轨道容器触发，统一 Tooltip；在淡化层外保持实心） */}
          <Tooltip
            isOpen={showsDisabledMessage() && disabledMsgOpen()}
            label={local.disabledMessage}
            id={disabledMsgId}
            placement={isVertical() ? "end" : "top"}
          />
        </div>

        {/* 行尾文本值 */}
        <Show when={valueDisplay() === "text"}>
          <span {...stylex.props(styles.textValue)}>
            {isRange()
              ? `${displayValue(values()[0])} – ${displayValue(values()[1])}`
              : displayValue(values()[0])}
          </span>
        </Show>
      </div>

      {/* 校验状态消息 */}
      <Show when={local.status?.message != null}>
        <div
          id={statusId}
          {...stylex.props(styles.status, statusStyle())}
        >
          {local.status?.message}
        </div>
      </Show>

      {/* role="slider" 不支持 aria-required：视觉隐藏 span 经 aria-describedby 传达必填 */}
      <Show when={conveysRequired()}>
        <span id={requiredId} {...stylex.props(styles.labelHidden)}>
          {t("field.required")}
        </span>
      </Show>
    </div>
  );
}

Slider.displayName = "Slider";
