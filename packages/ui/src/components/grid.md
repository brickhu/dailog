# Grid 网格布局

两站共享的 CSS Grid 布局容器（studio 工作台 + site 消费端）。复刻自 [Astryx Grid](https://astryx.atmeta.com/components/Grid)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现（[github.com/facebook/astryx](https://github.com/facebook/astryx)）；技术栈为 **Solid + StyleX**，间距/对齐的视觉值全部引用 `theme.stylex` tokens（`dimensions.spacingN`）。

- 源文件：`packages/ui/src/components/grid.tsx`（配套 `grid-span.tsx` / `grid-span.md`）
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`；间距档位类型复用 `./dialog` 的 `SpacingStep`，无新增依赖

## 设计思想

Grid 是**纯 CSS Grid 容器**（`display: grid`），不做任何 JS 布局计算：

- **固定列**：`columns={N}`（**1–12**，超出钳制）→ `repeat(N, 1fr)`，等宽 N 列
- **断点列数**：`columns={{base, tablet?, desktop?}}` → 内置响应式，各断点固定列数（`@media` 覆盖 + 双类特异性），缺省向小断点继承：`{base: 4, desktop: 12}` = 手机/平板 4 列、桌面 12 列
- **响应式列**：`columns={{minWidth: 280}}` → `repeat(auto-fill, minmax(280px, 1fr))`，浏览器按容器宽度自动换行（每列至少 280px），**不依赖任何媒体查询**
- **auto-fill vs auto-fit**：`repeat: 'fill'`（默认）保留空轨道 → 所有条目宽度一致；`repeat: 'fit'` 折叠空轨道 → 条目少时拉伸填满整行
- **max 封顶**：`columns={{minWidth: 280, max: 4}}` 限制最多 4 列（避免大屏过宽）。封顶数学见下
- **轨道模板走 CSS 变量间接层**（StyleX 动态样式）：内联只写 `--x-gridTemplateColumns`，`grid-template-columns` 声明在类里——消费方 `xstyle` 覆盖（**包括 `@media` 查询内的**）仍能生效；如果写成裸内联样式，任何类都打不过它
- **瀑布流**：`rowHeight={N}` 设置隐式行高（`grid-auto-rows: Npx`），配合 `GridSpan rows={N}` 让条目跨多行

### 列数上限：最多 12 列

网格系统**最多 12 列**（`GRID_MAX_COLUMNS = 12`）：固定列数、响应式 `max`、`GridSpan` 跨列三个入口统一钳制到 1–12（`clampColumns`，含取整与兜底），类型层面用 `GridColumnCount = 1 | 2 | … | 12` 约束。

### 手机响应式怎么布局（例：桌面 12 列 / 手机 4 列）

两种途径，按需选择：

**① 内容驱动（推荐，零媒体查询）**——`columns={{minWidth, max}}`，浏览器按容器宽度自动重排，列数由 `minWidth` 决定：

```tsx
<Grid columns={{ minWidth: 80, max: 12 }} gap={2}>
  <For each={cards}>{(c) => <Card>…</Card>}</For>
</Grid>
```

手机（容器 ≈360px）约 4 列，桌面最宽 12 列，中间任何宽度都自然过渡；代价是列数是「算出来的」（平板可能是 6 列），不严格等于断点值。

**② 精确断点（严格 4 / 8 / 12）——内置 `GridBreakpoints`（推荐）**：

```tsx
<Grid columns={{ base: 4, tablet: 8, desktop: 12 }} gap={2}>
  <For each={cards}>{(c) => <Card>…</Card>}</For>
</Grid>

// 缺省向小断点继承：手机/平板 4 列，桌面 12 列
<Grid columns={{ base: 4, desktop: 12 }} gap={2}>…</Grid>
```

断点沿用项目常量：`tablet` = `640px ≤ width < 1024px`、`desktop` = `width ≥ 1024px`；列数钳制到 1–12。实现上是 `@media` 覆盖 `grid-template-columns`——这正是轨道模板走 CSS 变量间接层的原因：StyleX 会把媒体查询里的覆盖规则生成为**双类特异性**（`.x.y:not(#\#)`，0,2,0），必然赢过内部 `var(--x-gridTemplateColumns)` 规则（0,1,0）。

**③ 手动断点（同 ② 的机制，自定义断点/组合）**——`xstyle` + `@media` 覆盖：

```tsx
import { DESKTOP, TABLET } from "../theme.stylex.const"; // 项目断点常量

const styles = stylex.create({
  cols: {
    gridTemplateColumns: "repeat(4, 1fr)", // 手机（移动优先默认）
    [TABLET]: { gridTemplateColumns: "repeat(8, 1fr)" },
    [DESKTOP]: { gridTemplateColumns: "repeat(12, 1fr)" },
  },
  d12: { [DESKTOP]: { gridTemplateColumns: "repeat(12, 1fr)" } }, // 只覆盖桌面
});

// 严格断点：手机 4 / 平板 8 / 桌面 12（xstyle 完整接管时无需传 columns）
<Grid xstyle={styles.cols} gap={2}>…</Grid>

// 最小模式：columns={4} 兜底手机，仅桌面覆盖为 12
<Grid columns={4} xstyle={styles.d12} gap={2}>…</Grid>
```

> 注意：`GridSpan columns={N}` 是固定跨列，断点切换会「跨过头」（桌面 12 列 span 6 = 半行，手机 4 列时 span 6 超出网格）。要么用 `columns="full"`（任意列数都跨整行），要么给 GridSpan 也传 `xstyle` 覆盖 `grid-column` 做断点跨列（见 `grid-span.md`）。

### max 封顶的数学

封顶落在轨道的 **min** 上而非 max：每列至少 `perColumn = (100% - (max-1) × gap) / max`，超过 max 列永远放不下；轨道 **max** 保持 `1fr`，所以列数不足 max 时（尤其移动端只剩一列）实际存在的列仍**撑满整行——右侧无空白**。

轨道 min = `min(100%, max(minWidth, perColumn))`：显式 `minWidth` 仍被尊重；外层 `min(100%, …)` 保证容器比 minWidth/perColumn 更窄时单列收缩不溢出。

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `columns` | `GridColumnCount \| { minWidth: number; max?: GridColumnCount; repeat?: 'fill' \| 'fit' } \| GridBreakpoints` | `1`（单列） | 列配置。数字=固定等宽列（**上限 12**，超出钳制）；`{minWidth…}`=内容驱动响应式；`GridBreakpoints`=断点列数（见上）。`0`/负数/缺省回退单列 `1fr` |
| `width` | `number \| string` | — | 容器宽度：数字=px，字符串原样（如 `'100%'`） |
| `height` | `number \| string` | — | 容器高度：数字=px，字符串原样 |
| `maxWidth` | `number \| string` | — | 最大宽度：数字=px，字符串原样 |
| `minHeight` | `number \| string` | — | 最小高度：数字=px，字符串原样 |
| `gap` | `SpacingStep`（`0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10`） | — | 行/列统一间距（1 = 4px，2 = 8px…；0.5/1.5 = 2px/6px） |
| `rowGap` | `SpacingStep` | — | 行间距，覆盖 `gap` 的行轴 |
| `columnGap` | `SpacingStep` | — | 列间距，覆盖 `gap` 的列轴（`max` 封顶的 perColumn 计算也用它） |
| `rowHeight` | `number` | — | 隐式行轨道高度（px，`grid-auto-rows`）——配 `GridSpan rows` 做瀑布流 |
| `align` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'stretch'` | 纵向对齐（`align-items`） |
| `justify` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'stretch'` | 横向对齐（`justify-items`） |
| `children` | `JSX.Element` | — | 网格内容（通常为 `Card`、`GridSpan` 或普通元素） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（`stylex.create` 产物），最后合并、冲突时覆盖内部；**可覆盖 `grid-template-columns`/`grid-auto-rows`（含 `@media` 内）** |
| `className` / `class` | `string` | — | 外部 CSS 类，与内部 stylex 类名拼接共存 |
| `style` | `CSSProperties` | — | 根元素内联样式（与内部尺寸/动态 CSS 变量合并，页面级微调） |
| `ref` | `(el: HTMLDivElement) => void` | — | 根元素引用（Solid 回调） |
| `data-testid` | `string` | — | 测试选择器 |

其余原生属性（`id`、`aria-*`、`data-*`、`on*` 事件等）透传给根元素。

## 使用示例

```tsx
import { Grid, GridSpan } from "@dailogues/ui";

// 固定 3 列卡片墙
<Grid columns={3} gap={4}>
  <Card>…</Card>
  <Card>…</Card>
  <Card>…</Card>
</Grid>

// 响应式：每列至少 280px，浏览器自动换行（无需媒体查询）
<Grid columns={{ minWidth: 280 }} gap={5}>
  <For each={cards}>{(c) => <Card>…</Card>}</For>
</Grid>

// auto-fit：条目少时拉伸填满整行（对比上方 auto-fill 保持等宽）
<Grid columns={{ minWidth: 250, repeat: "fit" }} gap={4}>…</Grid>

// max 封顶：最多 3 列，但不足 3 列时（移动端单列）仍撑满整行
<Grid columns={{ minWidth: 250, max: 3 }} gap={4}>…</Grid>

// 行列不同间距
<Grid columns={3} rowGap={2} columnGap={6}>…</Grid>

// 错落布局：固定行高 + GridSpan 跨行（瀑布流）
<Grid columns={4} rowHeight={80} gap={4}>
  <GridSpan rows={4}>…高条目…</GridSpan>
  <GridSpan rows={2}>…中条目…</GridSpan>
  <GridSpan columns={2} rows={2}>…2×2 区块…</GridSpan>
  <GridSpan columns="full">…整行横幅…</GridSpan>
</Grid>

// 对齐：网格内条目垂直居中 / 靠左
<Grid columns={3} align="center" justify="start">…</Grid>

// 尺寸 + 外部样式
const styles = stylex.create({ panel: { padding: "16px" } });
<Grid columns={2} width="100%" maxWidth={960} xstyle={styles.panel}>…</Grid>
```


### 示范：断点列数（手机 4 / 平板 8 / 桌面 12）

完整可跑示例（Solid + StyleX）：

```tsx
// BreakpointGridDemo.tsx —— 24 个色块，视口变化时自动 4 → 8 → 12 列
import { For } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { Grid } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";

// 卡片样式（示例用，可换成真实 Card 组件）
const styles = stylex.create({
  tile: {
    height: 64,
    display: "grid",
    placeItems: "center",
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surfaceWeak,
    color: colors.onSurfaceWeak,
  },
});

export function BreakpointGridDemo() {
  return (
    <Grid columns={{ base: 4, tablet: 8, desktop: 12 }} gap={2}>
      <For each={Array.from({ length: 24 })}>
        {(_, i) => <div {...stylex.props(styles.tile)}>#{i() + 1}</div>}
      </For>
    </Grid>
  );
}
```

拉宽/收窄视口（或开发者工具设备模拟），布局变化：

| 视口 | 列数 | 效果（24 个卡片） |
|---|---|---|
| `< 640px`（手机） | `base: 4` | 每行 4 个，共 6 行 |
| `640–1024px`（平板） | `tablet: 8` | 每行 8 个，共 3 行 |
| `≥ 1024px`（桌面） | `desktop: 12` | 每行 12 个，共 2 行 |

行为细节：

- **继承**：把 `desktop` 去掉（`{base: 4, tablet: 8}`）→ 桌面仍显示 8 列（继承 tablet）；只留 `{base: 4, desktop: 12}` → 平板显示 4 列（继承 base）
- **钳制**：列数超过 12 自动钳到 12（如 `desktop: 13` → 12 列）
- **与 GridSpan 配合**：跨列是固定值，窄屏会「跨过头」——整行用 `columns="full"`，断点化跨列用 `xstyle`（见 `grid-span.md`）
- **与 gap 配合**：`gap`/`rowGap`/`columnGap` 独立于列数，各断点下间距一致

## 无障碍

- Grid 是纯布局容器（`div`），**不添加任何角色/ARIA**：语义由内容决定（卡片列表外层用 `role="list"` + 子项 `role="listitem"` 或直接用普通 div）
+- 与 Astryx 一致：`display: grid` 不改变元素的阅读顺序（源码顺序 = DOM 顺序），键盘导航不受影响
- 所有原生属性透传，需要时可自行加 `aria-label` 等

## 与 Astryx 原版的差异

1. **API 形态**：Solid 回调 `ref`（非 React `ref` 对象）；`className`/`class` 等价；`style` 为 `CSSProperties` 对象
2. **间距档位**：Astryx 的 `--spacing-0/-0-5/…` 变量映射为 `theme.stylex` 的 `dimensions.spacingN`（整数档）；0.5/1.5 档（2px/6px）无 token，按 dialog 惯例内联（封顶 calc 里也内联）
3. **无 `themeProps`/`astryx-grid` 主题类名**：本站样式统一走 `xstyle` + tokens，不输出 Astryx 的 theming 目标类名（`astryx-grid`/`astryx-grid-span`）
4. **无 Layer 系统**：Grid 本身不需要；涉及弹层的用法请参考本站 dialog/popover 体系
5. **列数上限 12**（原版无限制）：新增 `GRID_MAX_COLUMNS` / `GridColumnCount`，固定列数、响应式 `max`、`GridSpan` 跨列均钳制到 1–12
6. **内置断点列数 `GridBreakpoints`**（原版无）：`{base, tablet?, desktop?}` 断点列数，缺省向小断点继承（tablet = 640–1024px、desktop = ≥1024px，沿用项目 `theme.stylex.const` 断点）

## 已知限制

1. **`columns` 为响应式对象时轨道模板是运行时字符串**：Solid 中改为响应式变化（如根据状态改 `minWidth`）会重新生成模板并更新 CSS 变量——正常，但频繁切换无意义
2. **`repeat: 'fit'` + `max` 同时用时**，`auto-fit` 的空轨道折叠与封顶 calc 并存，行为由浏览器决定（与 Astryx 一致，未做额外处理）
3. **`gap` 参与封顶 calc**：`columnGap` 优先于 `gap` 计入 perColumn 公式（与 Astryx 一致）；两个都传时封顶宽度按 `columnGap` 计算

## 参考

- [Astryx Grid 文档](https://astryx.atmeta.com/components/Grid)（抓取日期 2026-08-19）
- [Grid.tsx / GridSpan.tsx / Grid.test.tsx（facebook/astryx, MIT）](https://github.com/facebook/astryx/tree/main/packages/core/src/Grid)