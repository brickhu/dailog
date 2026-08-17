# Skeleton 加载占位

两站共享的加载占位组件（studio 工作台 + site 消费端）。复刻自 [Astryx Skeleton](https://astryx.atmeta.com/components/Skeleton)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现；技术栈为 **Solid + StyleX**，圆角变量引用 `theme.stylex` 的 `dimensions.radius*` tokens。

- 源文件：`packages/ui/src/components/skeleton.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`（无新增依赖）
- 底色与动画时长：`theme.stylex` 暂无 skeleton token 与 `duration-medium-max` 档位，组件内内联（浅色 `#9a9a9a` / 深色 `#5c5f66`、300ms）

```tsx
import { Skeleton } from "@dailogues/ui";
```

## 基本用法

```tsx
// 单骨架
<Skeleton width={200} height={20} />
// 头像 + 多骨架波浪效果（index 交错动画延迟）
<div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
  <Skeleton width={40} height={40} radius="rounded" />
  <Skeleton width={300} height={16} index={0} />
  <Skeleton width={280} height={16} index={1} />
</div>
```

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `width` | `number \| string` | `"100%"` | 数字=px，字符串原样 |
| `height` | `number \| string` | `"100%"` | 同上 |
| `radius` | `"none" \| 0 \| 1 \| 2 \| 3 \| 4 \| "rounded"` | `3` | 圆角档位：none=0 / 0=radius0 / 1=radiusSm / 2=radiusMd / 3=radiusLg / 4=radiusXl / rounded=radiusFull |
| `index` | `number` | `0` | 交错动画序号，多个骨架用 0,1,2,… 产生波浪效果 |
| `xstyle` | `StyleXStyles` | — | 外部 StyleX 样式，最后合并、冲突时覆盖 |
| `class` / `className` | `string` | — | 与内部 stylex 类名拼接 |
| 其余 | 原生 `div` 属性 | — | 透传（`ref`、`data-testid`、`aria-*` 等） |

## 行为契约

- 纯装饰加载占位：`aria-hidden="true"`，读屏不播报空内容——加载态由外层区域 `aria-busy` 表达
- 闪烁动画：opacity `0.25↔1` 交替（`steps(10, end)` 步进、无限循环）；`prefers-reduced-motion: reduce` 时停用（静态占位仍可读）
- 动画延迟 `1000ms + 100ms × index`：防快速加载内容闪动 + 多骨架波浪效果
- 对比度适配：`prefers-contrast: more` 时底色混入前景色 30%；`forced-colors: active`（Windows 高对比）时用系统色 `GrayText` + opacity 1（否则 painted background 被剥掉、占位不可见，WCAG 1.4.11）
