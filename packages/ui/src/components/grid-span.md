# GridSpan 跨列 / 跨行

两站共享的 Grid 网格项控制组件（studio 工作台 + site 消费端）。复刻自 [Astryx Grid Span](https://astryx.atmeta.com/components/GridSpan)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现（[github.com/facebook/astryx](https://github.com/facebook/astryx)）；技术栈为 **Solid + StyleX**。

GridSpan 让一个网格项跨多列/多行，用于**瀑布流、仪表盘、不对称布局**。必须作为 `Grid` 的直接子项使用才有意义（网格项定位由父容器 `grid-template-columns` 决定）。

- 源文件：`packages/ui/src/components/grid-span.tsx`（配套 `grid.tsx` / `grid.md`）
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`，无新增依赖

## 设计思想

- **跨列**：`columns={N}`（**1–12**，超出钳制）→ `grid-column: span N`；`columns="full"` → `grid-column: 1 / -1`（跨满整行）
- **跨行**：`rows={N}` → `grid-row: span N`。行高由父 `Grid rowHeight` 决定（`grid-auto-rows`）——不设 `rowHeight` 时行高由内容撑开，跨行同样生效
- **基础样式**：`minWidth: 0` 防止网格项溢出（图片/长内容默认 `min-width: auto`）；`display: grid` + `height: 100%` 让跨行条目填满整个单元格并拉伸子项（子项 `height: 100%` 生效）
- 跨列/跨行走**内联样式**（调用方显式设定）；基础样式走 StyleX 类，可被 `xstyle` 覆盖
- 跨列是**固定值**，不随断点变化：断点列数由父 `Grid` 决定，`GridSpan` 在窄屏可能「跨过头」（见「响应式跨列」）

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `columns` | `GridColumnCount \| 'full'` | — | 跨列数：`1–12`（超出钳制）= `grid-column: span N`；`'full'` = `1 / -1` 跨满整行 |
| `rows` | `number` | — | 跨行数：`grid-row: span N` |
| `children` | `JSX.Element` | — | 内容（通常为 `Card`） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（`stylex.create` 产物），最后合并、冲突时覆盖内部 |
| `className` / `class` | `string` | — | 外部 CSS 类，与内部 stylex 类名拼接共存 |
| `style` | `CSSProperties` | — | 根元素内联样式（与跨列/跨行内联合并；可用它覆盖 `grid-column`/`grid-row`） |
| `ref` | `(el: HTMLDivElement) => void` | — | 根元素引用（Solid 回调） |
| `data-testid` | `string` | — | 测试选择器 |

其余原生属性（`id`、`aria-*`、`data-*`、`on*` 事件等）透传给根元素。

## 使用示例

```tsx
import { Grid, GridSpan } from "@dailogues/ui";

// 跨 2 列 / 3 列 / 整行的卡片墙
<Grid columns={4} gap={4}>
  <GridSpan columns={2}><Card>跨 2 列</Card></GridSpan>
  <Card>普通</Card>
  <Card>普通</Card>
  <GridSpan columns={3}><Card>跨 3 列</Card></GridSpan>
  <GridSpan columns="full"><Card>整行横幅</Card></GridSpan>
</Grid>

// 瀑布流：固定行高 80px，条目跨不同行数
<Grid columns={4} rowHeight={80} gap={4}>
  <GridSpan rows={4}><Card style={{ height: "100%" }}>高条目</Card></GridSpan>
  <GridSpan rows={2}><Card style={{ height: "100%" }}>中条目</Card></GridSpan>
  <Card style={{ height: "100%" }}>单行</Card>
  <GridSpan columns={2} rows={2}><Card style={{ height: "100%" }}>2×2 主图表</Card></GridSpan>
  <Card style={{ height: "100%" }}>指标</Card>
</Grid>

// 仪表盘：主图 2×2 + 整行分区
<Grid columns={4} gap={4}>
  <GridSpan columns={2} rows={2}><Card>主图</Card></GridSpan>
  <Card>指标 1</Card>
  <Card>指标 2</Card>
  <Card>指标 3</Card>
  <Card>指标 4</Card>
  <GridSpan columns="full"><Card>整行区块</Card></GridSpan>
</Grid>
```

## 响应式跨列

`columns={N}` 是固定跨列，断点切换时可能「跨过头」（桌面 12 列 span 6 = 半行，手机 4 列时 span 6 超出网格，会产生隐式轨道/溢出）。两种处理：

```tsx
// ① 任意列数下都安全的整行
<GridSpan columns="full">…</GridSpan>

// ② 断点化跨列：xstyle 覆盖 grid-column（媒体查询覆盖同样靠双类特异性生效）
import { DESKTOP } from "../theme.stylex.const";
const spanStyles = stylex.create({
  half: {
    gridColumn: "span 2", // 手机 4 列：占半行
    [DESKTOP]: { gridColumn: "span 6" }, // 桌面 12 列：占半行
  },
});
<GridSpan xstyle={spanStyles.half}>…</GridSpan>
```

## 无障碍

- GridSpan 是纯布局 div，**不添加任何角色/ARIA**；跨列/跨行不改变源码顺序（DOM 顺序 = 阅读顺序）
- 无键盘交互，与普通网格项一致；需要时可自行透传 `aria-*`

## 与 Astryx 原版的差异

1. **API 形态**：Solid 回调 `ref`；`className`/`class` 等价；`style` 为 `CSSProperties` 对象
2. **无 `astryx-grid-span` 主题类名**：本站样式统一走 `xstyle` + tokens
3. **跨列上限 12**（原版无限制）：`columns` 类型收窄为 `GridColumnCount`，超出钳制为 `span 12`（网格最多 12 列，跨更多无意义）
3. 无其他行为差异（跨列/跨行语义、基础样式与 Astryx 完全一致）

## 参考

- [Astryx Grid Span 文档](https://astryx.atmeta.com/components/GridSpan)（抓取日期 2026-08-19）
- [GridSpan.tsx（facebook/astryx, MIT）](https://github.com/facebook/astryx/blob/main/packages/core/src/Grid/GridSpan.tsx)