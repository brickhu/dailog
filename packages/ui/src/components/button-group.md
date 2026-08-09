# ButtonGroup 按钮组

多个按钮连接成组的容器（复刻自 [Astryx ButtonGroup](https://astryx.atmeta.com/components/ButtonGroup)，MIT）。相关操作（复制/剪切/粘贴、撤销/重做）组合为单个连接控件；**按钮间共享边框、圆角只在两端、水平或垂直方向**。技术栈为 **Solid + StyleX**，视觉变量引用 `theme.stylex` 非废弃 tokens。

- 源文件：`packages/ui/src/components/button-group.tsx`（依赖 `button.tsx` 的 `ButtonSize`/`ButtonElevation` 类型）
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`（无新增依赖）

```tsx
import { ButtonGroup, Button } from "@dailogues/ui";
```

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `children` | `JSX.Element` | 必填 | Button/IconButton 子元素（2–4 个为宜） |
| `label` | `string` | 必填 | 组可访问名（`aria-label`） |
| `orientation` | `"horizontal" \| "vertical"` | `"horizontal"` | 布局方向 |
| `size` | `"sm" \| "md" \| "lg" \| "xl" \| "xxl"` | `"md"` | 组内按钮默认尺寸；单个按钮可显式覆盖 |
| `isDisabled` | `boolean` | `false` | 整组禁用（子按钮全部禁用，容器 `aria-disabled`） |
| `elevation` | `"none" \| "low" \| "med" \| "high"` | `"none"` | 整组悬浮阴影（连接按钮共享一个表面，整体抬起；wrapper 带组端圆角让阴影跟随外形） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（布局定制，冲突时覆盖内部） |
| `class` / `className` | `string` | — | 外部类，与内部 stylex 类名拼接（不覆盖） |
| `style` | `JSX.CSSProperties` | — | 内联样式 |
| `onKeyDown` | `(e: KeyboardEvent) => void` | — | 与方向键导航合并（先调消费方，再导航） |

其余原生 `div` 属性（`aria-*`、`data-*`、`id` 等）透传。

## 行为

### 连接样式（纯 CSS，无需 JS 测量）

子 Button 经 Context 感知组，自动应用：

- **圆角只在两端**：首元素 start 侧、尾元素 end 侧恢复圆角（跟随组尺寸默认：`sm` 组 4px，其余 8px），中间成员圆角 0
- **1px 分隔边框**：horizontal 组按钮间 `border-inline-start`、vertical 组 `border-block-start`（首元素 0）
  - 默认色：`ink` 15% 半透明（深浅模式自适应）
  - 实心（`appear="fill"`）成员相邻处：`on{variant}` 20% 半透明，与实心底色协调
- **组内行为让位**：按压缩放（`:active` scale）组内关闭；`elevation` 由组拥有（组内按钮的 `elevation` 被忽略）
- **组内 round 由组接管**：成员的 `round` 显式值被组端圆角规则覆盖（组外观统一）

### 整组禁用

`isDisabled` → 子按钮全部禁用（含 `aria-disabled` 语义）；组容器带 `aria-disabled`。

### 键盘导航（WAI-ARIA toolbar 方向键模式）

- **方向键**：`ArrowLeft/ArrowRight`（horizontal）或 `ArrowUp/ArrowDown`（vertical）在按钮间移动焦点，**到达两端循环回绕**（wrap）
- **Home / End**：跳到组内第一个 / 最后一个可用按钮
- **跳过禁用项**：`aria-disabled="true"` / `disabled` 属性按钮不可达
- **修饰键**：Ctrl/Cmd/Alt + 方向键不拦截（浏览器快捷键优先）
- **RTL**：水平方向键自动跟随容器 `direction`（视觉方向，WCAG 1.3.2）
- 无 roving tabindex：每个按钮独立 Tab 可达，方向键为快捷移动

### 尺寸继承

组 `size` 作为组内按钮的默认尺寸（含字号/图标/端圆角档位），成员显式 `size` 优先。

## 使用示例

```tsx
// 基础（horizontal + md）
<ButtonGroup label="文本操作">
  <Button label="复制" />
  <Button label="剪切" />
  <Button label="粘贴" />
</ButtonGroup>

// 垂直 + 实心成员（分隔边框自动用 on 色）
<ButtonGroup label="审批操作" orientation="vertical" size="sm">
  <Button label="通过" variant="success" />
  <Button label="驳回" variant="danger" />
</ButtonGroup>

// 整组禁用 + 组级悬浮阴影
<ButtonGroup label="发布操作" isDisabled elevation="med">
  <Button label="预览" appear="ghost" />
  <Button label="发布" variant="brand" />
</ButtonGroup>

// 成员覆盖尺寸
<ButtonGroup label="操作" size="sm">
  <Button label="编辑" size="lg" />   // 这个按钮用 lg
  <Button label="删除" />
</ButtonGroup>
```

## 无障碍

- 容器 `role="group"` + `aria-label`（label 必填）
- 整组禁用：容器 `aria-disabled` + 子按钮禁用
- 键盘：方向键导航 + Home/End（见上）；Tab 逐个进入按钮
- 成员按钮的 tooltip/loading/焦点样式行为与单独使用时一致

## 注意事项

1. **不要嵌套 ButtonGroup**（组内再放组会被外层组样式影响）；需要多组时并排并留间距。
2. **组内成员用同一 `appear`**（最佳实践：全部 fill 或全部 ghost/outline），视觉上才是单一连接单元。
3. **组内 `round` 被组接管**：成员的 `round="full"` 等显式值不生效（组端圆角由组尺寸决定）。
4. **分隔边框**依赖 `:not(:has(~ *:not([popover])))` 判定尾元素：成员按钮渲染额外兄弟 layer（如 popover）时仍能正确判尾；本项目 Button 的 tooltip 渲染在按钮内部，天然兼容。
5. **StyleX 0.19 不支持 `border` shorthand**（静默丢弃）——外部 `xstyle` 中写边框请用 `borderWidth` + `borderStyle` + `borderColor`。
