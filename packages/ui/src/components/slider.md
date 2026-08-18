# Slider 滑块

两站共享的范围/单值选择控件（studio 工作台 + site 消费端）。复刻自 [Astryx Slider](https://astryx.atmeta.com/components/Slider)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现（`facebook/astryx`）；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` 非废弃 tokens（`colors` / `dimensions` / `durations` / `easings` / `fontfamilies`）。

- 源文件：`packages/ui/src/components/slider.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`、`@dailogues/i18n`（新增 `field.required` / `field.optional` 两个词典键；无新增第三方依赖）

```tsx
import { Slider } from "@dailogues/ui";
```

## 特性一览

- **受控组件**：`value` 必填（`number` 单值 / `[number, number]` 范围双 thumb），`onChange` 拖动中回调、`onChangeEnd` 拖动结束（pointer up 或键盘）回调
- **键盘**：方向键 ±step、PageUp/PageDown ±step×10、Home/End 到 min/max（APG slider pattern）
- **指针**：整条轨道可点击跳转（自动选中并聚焦最近 thumb），拖拽走 pointer capture；点击刻度 mark 直接吸附
- **范围模式**：`minStepsBetweenThumbs` 限制双 thumb 最小间隔；aria 边界随兄弟 thumb 收窄
- **值显示**：`valueDisplay` = tooltip（自绘气泡，hover/focus/拖拽中常显）/ text（行尾）/ none
- **表单**：`htmlName` 渲染隐藏 input 参与提交（范围模式两个）；禁用时排除
- **无障碍**：完整 ARIA（role=slider / group、aria-valuenow/text、aria-disabled、必填经 aria-describedby 传达）；RTL 支持；touch 下轨道 24px 最小触摸目标；尊重 `prefers-reduced-motion`

## Props 接口

### 核心

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string` | — | 标签文本（始终渲染为可访问名；`isLabelHidden` 时仅屏幕阅读器可见） |
| `value` | `number \| [number, number]` | — | 当前值：`number` 单 thumb，`[number, number]` 范围双 thumb（数组形式自动进入范围模式） |
| `onChange` | `(value: number) => void` \| `(value: [number, number]) => void` | — | 拖动/键盘过程中值变化回调 |
| `onChangeEnd` | 同 `onChange` | — | 拖动结束回调（pointer up / pointer cancel / 键盘按键后） |

### 数值范围与步长

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `min` | `number` | `0` | 最小值 |
| `max` | `number` | `100` | 最大值 |
| `step` | `number` | `1` | 步长增量 |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | 方向；垂直时 bottom=min、top=max |
| `formatValue` | `(value: number) => string` | — | 值格式化函数（值气泡/文本显示与 `aria-valuetext` 共用） |
| `valueDisplay` | `"tooltip" \| "text" \| "none"` | `"tooltip"` | 当前值显示方式 |
| `marks` | `Array<{ value: number; label?: string }>` | — | 刻度 mark（点击吸附到该值；label 渲染于刻度旁） |
| `minStepsBetweenThumbs` | `number` | `0` | 范围模式下双 thumb 最小间隔（步数），防止重叠 |

### 状态与字段

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `isDisabled` | `boolean` | `false` | 禁用（opacity 0.5 + not-allowed） |
| `disabledMessage` | `string` | — | 禁用原因：与 `isDisabled` 同用时显示自绘 tooltip（hover/focus），thumb 经 `aria-disabled` 保持可聚焦；**勿用外部 Tooltip 包裹禁用控件**（禁用控件吞 hover 事件） |
| `isRequired` / `isOptional` | `boolean` | `false` | 必填/选填标记（`isOptional` 优先）；`role="slider"` 不支持 `aria-required`，必填经 `aria-describedby` 指向视觉隐藏 span 传达 |
| `isLabelHidden` | `boolean` | `false` | 视觉隐藏标签（仍可访问）；隐藏时不渲染 label 行（其 margin 不产生控件上方空隙） |
| `description` | `string` | — | 标签下方说明文本（接入 `aria-describedby`） |
| `status` | `{ type: "warning" \| "error" \| "success"; message?: string }` | — | 校验状态：message 渲染于控件下方并接入 `aria-describedby`，error 时 thumb 带 `aria-invalid` |
| `labelTooltip` | `string` | — | 标签旁信息图标（ⓘ）的 tooltip 文本 |
| `htmlName` | `string` | — | 表单提交 name：渲染隐藏 input 携带当前值（范围模式两个，禁用时 `disabled` 排除） |

### 尺寸与样式注入

| Prop | 说明 | 优先级 |
|---|---|---|
| `width` | 字段宽度：数字=px、字符串原样（如 `"100%"`）；作用于整个字段（标签+控件+状态） | 与 `style` 合并时优先 |
| `style` | 内联样式（与 `width` 合并） | 内联 |
| `xstyle` | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** | 覆盖内部 |
| `class` / `className` | 外部 CSS 类，与内部 stylex 类名**拼接共存**（不覆盖） | 层叠取决于样式表顺序 |

> **字段外边距**：字段容器默认**无**外边距（Slider 常内联使用，如播放条）；需要上下间距时用 `xstyle` 的 `margin*` 自行添加。

```tsx
import * as stylex from "@stylexjs/stylex";

const pageStyles = stylex.create({
  wide: { width: "100%" },
});

<Slider label="音量" value={50} xstyle={pageStyles.wide} />
<Slider label="音量" value={50} class="my-slider" />
```

### 颜色定制

进度条与圆点颜色经根容器下发的 CSS 变量控制，用 `xstyle` 覆盖即可（默认走 `theme.stylex`）：

| 变量 | 作用 | 默认 |
|---|---|---|
| `--slider-accent` | 进度条（filled track）+ 圆点（thumb），hover 加深与 focus 描边跟随 | `colors.primary` |
| `--slider-track` | 背景轨道 | `colors.surfaceWeak` |

```tsx
const myStyles = stylex.create({
  warm: {
    "--slider-accent": colors.danger,   // 进度条 + 圆点
    "--slider-track": colors.warningWeak, // 背景轨道
  },
});

<Slider label="音量" value={50} xstyle={myStyles.warm} />
```

## 用法示例

### 基础单值（受控）

```tsx
import { createSignal } from "solid-js";
import { Slider } from "@dailogues/ui";

function Volume() {
  const [value, setValue] = createSignal(50);
  return (
    <Slider
      label="音量"
      value={value()}
      onChange={setValue}
      onChangeEnd={(v) => console.log("拖动结束：", v)}
    />
  );
}
```

### 范围双 thumb + 最小间隔

```tsx
const [range, setRange] = createSignal<[number, number]>([20, 80]);

<Slider
  label="价格区间"
  value={range()}
  onChange={setRange}
  min={0}
  max={100}
  minStepsBetweenThumbs={1}
  formatValue={(v) => `$${v}`}
/>
```

### 刻度 marks（点击吸附）

```tsx
<Slider
  label="CPU 频率"
  value={2400}
  min={800}
  max={5000}
  step={100}
  marks={[
    { value: 800, label: "省电" },
    { value: 2900, label: "平衡" },
    { value: 5000, label: "性能" },
  ]}
/>
```

### 垂直方向 + 文本值显示

```tsx
<Slider
  label="透明度"
  value={60}
  orientation="vertical"
  valueDisplay="text"
  formatValue={(v) => `$${v}%`}
/>
```

### 禁用与禁用原因

```tsx
<Slider
  label="音量"
  value={50}
  isDisabled
  disabledMessage="共享屏幕时音量已锁定"
/>
```

### 表单提交

```tsx
<form onSubmit={...}>
  {/* 提交时携带 volume=50（范围模式提交两个同名 input，如 price=20&price=80） */}
  <Slider label="音量" value={50} htmlName="volume" />
</form>
```

### 字段状态（必填 + 校验）

```tsx
<Slider
  label="价格"
  value={30}
  isRequired
  description="建议不低于成本价"
  status={{ type: "error", message: "价格超出合理区间" }}
/>
```

## 键盘操作

| 键 | 行为 |
|---|---|
| `←` / `↓` | 减 step |
| `→` / `↑` | 加 step |
| `PageUp` / `PageDown` | ± step×10 |
| `Home` / `End` | 到 min / max |

键盘调整同样触发 `onChange`（每次按键）与 `onChangeEnd`（携带精确更新后的值）。

## 无障碍（ARIA 结构）

- 单值模式：thumb 为 `role="slider"`，经 `aria-labelledby` 指向可见 `<label>`；范围模式：轨道容器为 `role="group"`（`aria-labelledby` 指向 label），两个 thumb 各带 `aria-label="Minimum value" / "Maximum value"`
- 每个 thumb：`aria-valuemin/max/now`、`aria-orientation`、`aria-valuetext`（设置 `formatValue` 时）、`aria-disabled`（禁用时）、`aria-invalid`（status=error 时）
- 范围模式下 thumb 的 `aria-valuemin/max` 随兄弟 thumb 收窄（含 `minStepsBetweenThumbs` 间隔），与实际移动 clamp 一致（WCAG 1.3.2）
- `description` / `status.message` / 必填提示 / 禁用原因均经 `aria-describedby` 关联到 thumb
- 轨道容器/刻度 `aria-hidden="true"`；值气泡与禁用 tooltip `role="tooltip"`

## 行为细节

- **行程内缩**：thumb 行程两端各内缩半个 thumb 宽（原生 range 几何），thumb 在 min/max 不会越出组件盒；fill 与 marks 走同一映射，pointer→值逆映射保证按住 thumb 不跳值
- **精度**：值先 clamp 到 `[min, max]`，再按 min/step 的十进制精度取整——`step={0.1}` 时得到 `0.3` 而非 `0.30000000000000004`（onChange 载荷、aria-valuenow、气泡一致）
- **越界保护**：受控 `value` 超出 [min, max] 时自动 clamp 后渲染与暴露 ARIA 值
- **RTL**：位置走 logical properties（`insetInlineStart` 等），thumb/mark 居中 transform 在 `dir="rtl"` 下翻转；pointer 映射按轨道 computed direction 测量
- **轨道容器**：恒为 20px 高（与 thumb 等高），圆点贴合容器顶边，轨道/填充条居中；整条轨道可点击