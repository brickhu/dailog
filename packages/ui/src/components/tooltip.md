# Tooltip 提示气泡

两站共享的统一自绘 tooltip（Button / TextInput / Slider 等组件内部全部经此组件渲染）。复刻自 [Astryx Tooltip](https://astryx.atmeta.com/components/Tooltip) 的展示形态（Meta 开源设计系统，MIT）；技术栈为 **Solid + StyleX**。

- 源文件：`packages/ui/src/components/tooltip.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`（无新增依赖）

```tsx
import { Tooltip } from "@dailogues/ui";
```

## 视觉规格（统一配色）

| 部位 | 规则 |
|---|---|
| 底色 | `colors.foreground`（主题反色面：亮色=深底，暗色=浅底） |
| 字色 | `colors.background`（主题反色面：亮色=浅字，暗色=深字） |
| 覆盖 | `--tooltip-bg` / `--tooltip-text` 可覆盖（变量作用于气泡或任意祖先，经继承生效） |
| 位置 | 绝对定位于锚点（锚点需 `position: relative`）：`top` 上方居中 / `bottom` 下方左对齐 / `end` 侧边（inline-end）居中 |
| 动效 | 淡入 120ms，尊重 `prefers-reduced-motion` |

## Props

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string` | — | 提示内容；`undefined` 时整体不渲染 |
| `isOpen` | `boolean` | — | 显示开关（hover/focus 等由锚点组件控制） |
| `id` | `string` | — | 关联 id（供锚点 `aria-describedby` 指向） |
| `placement` | `"top" | "bottom" | "end"` | `"top"` | 位置：上方居中 / 下方左对齐 / 侧边（inline-end）居中 |
| `xstyle` | `StyleXStyles` | — | 外部样式注入（作用于气泡外层，如 maxWidth/阴影/换行） |

## 使用示例

```tsx
import { createSignal } from "solid-js";
import { Tooltip } from "@dailogues/ui";

const [open, setOpen] = createSignal(false);

// 锚点自带 position: relative；hover/focus 显隐由锚点组件或调用方控制
<Tooltip isOpen={open()} label="删除后不可恢复" />

// 下方左对齐 + 限宽换行（信息气泡）
<Tooltip isOpen={open()} label="最多 200 字" placement="bottom" xstyle={styles.info} />

// 侧边（垂直滑块等竖向场景）
<Tooltip isOpen={open()} label="50" placement="end" />
```

## 无障碍行为

- 渲染 `role="tooltip"`，经 `id` + 锚点 `aria-describedby` 关联
- 锚点组件自行负责 hover/focus 触达（含禁用态 `aria-disabled` 保持键盘可聚焦场景）

## 已知限制

1. 气泡绝对定位于锚点上方/下方/侧边，祖先容器 `overflow: hidden` 且锚点贴边时可能被裁剪。
