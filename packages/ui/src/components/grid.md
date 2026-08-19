# Grid 网格布局

两站共享的 CSS Grid 布局容器（studio 工作台 + site 消费端）。复刻自 [Astryx Grid](https://astryx.atmeta.com/components/Grid)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现（[github.com/facebook/astryx](https://github.com/facebook/astryx)）；技术栈为 **Solid + StyleX**，间距/对齐的视觉值全部引用 `theme.stylex` tokens（`dimensions.spacingN`）。

- 源文件：`packages/ui/src/components/grid.tsx`（配套 `grid-span.tsx` / `grid-span.md`）
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`；间距档位类型复用 `./dialog` 的 `SpacingStep`，无新增依赖

## 设计思想

Grid 是**纯 CSS Grid 容器**（`display: grid`），不做任何 JS 布局计算：

- **统一断点值**：`columns`、`minColWidth`、`repeat`、`maxCols`、`gap`、`rowGap`、`columnGap`、`padding`、`paddingX`、`paddingY`、`rowHeight`、`minRowHeight` **十二个属性**全部支持「单值 | 断点对象」（`GridBreakpointValue<T>`），断点对象 `{base, [TABLET]?, [DESKTOP]?}` 缺省向小断点继承
- **固定列**：`columns={N}`（**1–12**，超出钳制）→ `repeat(N, 1fr)`，等宽 N 列
- **断点列数**：`columns={{base: 4, [TABLET]: 8, [DESKTOP]: 12}}` → 各断点固定列数（`@media` 覆盖 + 双类特异性），缺省向小断点继承：`{base: 4, [DESKTOP]: 12}` = 手机/平板 4 列、桌面 12 列
- **内容驱动（响应式列）**：`minColWidth={280}` → `repeat(auto-fill, minmax(280px, 1fr))`，浏览器按容器宽度自动换行（每列至少 280px），**不依赖任何媒体查询**；`minColWidth`/`repeat`/`maxCols` 均可断点化
- **auto-fill vs auto-fit**：`repeat="fill"`（默认）保留空轨道 → 所有条目宽度一致；`repeat="fit"` 折叠空轨道 → 条目少时拉伸填满整行（仅配合 `minColWidth` 生效）
- **maxCols 封顶**：`maxCols={4}` 配合 `minColWidth` 限制最多 4 列（避免大屏过宽）。封顶数学见下
- **轨道模板走 CSS 变量间接层**（StyleX 动态样式）：内联只写 `--x-gridTemplateColumns`，`grid-template-columns` 声明在类里——消费方 `xstyle` 覆盖（**包括 `@media` 查询内的**）仍能生效；如果写成裸内联样式，任何类都打不过它
- **瀑布流**：`rowHeight={N}` 固定隐式行高（`grid-auto-rows: Npx`）；`minRowHeight={N}` 最小行高、行随内容增高（`minmax(Npx, auto)`，更实用，优先于 rowHeight）——配合 `GridSpan rows={N}` 让条目跨多行；两者均支持断点

### 列数上限：最多 12 列

网格系统**最多 12 列**（`GRID_MAX_COLUMNS = 12`）：固定列数（`columns`）、内容驱动封顶（`maxCols`）、`GridSpan` 跨列三个入口统一钳制到 1–12（`clampColumns`，含取整与兜底），类型层面用 `GridColumnCount = 1 | 2 | … | 12` 约束。

### 手机响应式怎么布局（例：桌面 12 列 / 手机 4 列）

两种途径，按需选择：

**① 内容驱动（推荐，零媒体查询）**——`minColWidth={N}`（可选 `maxCols` 封顶），浏览器按容器宽度自动重排，列数由 `minColWidth` 决定：

```tsx
<Grid minColWidth={80} maxCols={12} gap={2}>
  <For each={cards}>{(c) => <Card>…</Card>}</For>
</Grid>
```

手机（容器 ≈360px）约 4 列，桌面最宽 12 列，中间任何宽度都自然过渡；代价是列数是「算出来的」（平板可能是 6 列），不严格等于断点值。

**② 精确断点（严格 4 / 8 / 12）——内置 `GridBreakpoints`（推荐）**：

```tsx
import { TABLET, DESKTOP } from "@dailogues/ui/theme.stylex.const"; // 项目断点常量

// 手机 4 / 平板 8 / 桌面 12（key 用断点常量）
<Grid columns={{ base: 4, [TABLET]: 8, [DESKTOP]: 12 }} gap={2}>
  <For each={cards}>{(c) => <Card>…</Card>}</For>
</Grid>

// 字符串别名等价：{ base: 4, tablet: 8, desktop: 12 }
// 缺省向小断点继承：手机/平板 4 列，桌面 12 列
<Grid columns={{ base: 4, [DESKTOP]: 12 }} gap={2}>…</Grid>

// gap / padding 同样支持断点（各断点不同间距）
<Grid columns={{ base: 4, [TABLET]: 8, [DESKTOP]: 12 }} gap={{ base: 1, [TABLET]: 2, [DESKTOP]: 4 }} padding={{ base: 1, [DESKTOP]: 4 }}>…</Grid>
```

断点沿用项目常量：`TABLET` = `640px ≤ width < 1024px`、`DESKTOP` = `width ≥ 1024px`；列数钳制到 1–12。`columns`/`minColWidth`/`repeat`/`maxCols`/`gap`/`rowGap`/`columnGap`/`padding`/`paddingX`/`paddingY`/`rowHeight`/`minRowHeight` 十二者共用同一套断点语义（`GridBreakpointValue`）。实现上是 `@media` 覆盖对应 CSS 属性——这正是轨道模板走 CSS 变量间接层的原因：StyleX 会把媒体查询里的覆盖规则生成为**双类特异性**（`.x.y:not(#\#)`，0,2,0），必然赢过 base 的 `var(--x-*)` 规则（0,1,0）。

**③ 手动断点（同 ② 的机制，自定义断点/组合）**——`xstyle` + `@media` 覆盖：

```tsx
// ⚠️ 断点常量必须本地定义：stylex babel 插件不支持跨文件常量解析，
// 导入的 TABLET/DESKTOP 不能用在 stylex.create 里（会编译报错）——
// 只能用于 Grid 的 props key。值请与 theme.stylex.const 保持同步
const TABLET = "@media (640px <= width < 1024px)";
const DESKTOP = "@media (width >= 1024px)";

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

### maxCols 封顶的数学

封顶落在轨道的 **min** 上而非 max：每列至少 `perColumn = (100% - (maxCols-1) × gap) / maxCols`，超过 maxCols 列永远放不下；轨道 **max** 保持 `1fr`，所以列数不足 maxCols 时（尤其移动端只剩一列）实际存在的列仍**撑满整行——右侧无空白**。

轨道 min = `min(100%, max(minColWidth, perColumn))`：显式 `minColWidth` 仍被尊重；外层 `min(100%, …)` 保证容器比 minColWidth/perColumn 更窄时单列收缩不溢出。

## 断点值（GridBreakpointValue）

`columns`、`minColWidth`、`repeat`、`maxCols`、`gap`、`rowGap`、`columnGap`、`padding`、`paddingX`、`paddingY`、`rowHeight`、`minRowHeight` **十二者**共用同一套断点语义：可传单值，也可传 `{ base, [TABLET]?, [DESKTOP]? }`（key 推荐项目断点常量，字符串 `tablet`/`desktop` 为等价别名）：

```tsx
import { TABLET, DESKTOP } from "@dailogues/ui/theme.stylex.const";

// 单值：所有断点一致（等价于不传断点对象）
gap={2}

// 断点对象：base 必填，tablet/desktop 缺省向小断点继承
// 手机 gap=1 / 平板 gap=2 / 桌面 gap=4（desktop 缺省时继承 tablet）
gap={{ base: 1, [TABLET]: 2, [DESKTOP]: 4 }}
```

- **继承**：`desktop` 缺省继承 `tablet` → `base`；`tablet` 缺省继承 `base`。`{base: 2, [TABLET]: 4}` = 桌面仍 4
- **钳制**：列数（`GridColumnCount`）钳到 1–12；间距档位（`SpacingStep`）本身就是枚举，无越界问题
- **发射规则**：断点值与 base 相同时不产生多余媒体规则；media 规则由 StyleX 生成双类特异性（0,2,0），必然赢过 base（0,1,0）
- **注意**：内容驱动模式（`minColWidth`）里 `maxCols` 封顶的 perColumn 计算使用 `gap`/`columnGap` 的对应断点档位（calc 是单值字符串，每个断点各算一次；断点 gap 覆盖同时作用于 `gap` 属性本身）
- **优先级**：`columns` 与 `minColWidth` 二选一，同时传入时 `columns` 优先（`minColWidth`/`repeat`/`maxCols` 忽略）；`repeat`/`maxCols` 单独传入（无 `minColWidth`）不生效；`minRowHeight` 优先于 `rowHeight`

> **断点常量的导入边界**：`import { TABLET, DESKTOP } from "@dailogues/ui/theme.stylex.const"`（包 exports 已暴露，已验证）**只用于 Grid 的 props key**（`{base: 4, [TABLET]: 8}`，普通对象字面量，运行时按字符串匹配，可用）；**不能**用于你自己的 `stylex.create({… [TABLET]: …})`——stylex babel 插件无法跨文件解析常量，会编译报错，需本地定义同值字符串（与 `theme.stylex.const` 保持同步，见 `apps/site` 的 `episode-carousel.tsx` 惯例）

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `columns` | `GridColumnCount \| GridBreakpoints`（单值或断点对象） | `1`（单列） | 列数：固定/断点列数模式（**上限 12**，超出钳制）。`0`/负数/缺省回退单列 `1fr` |
| `minColWidth` | `GridBreakpointValue<number>` | — | 内容驱动模式：每列轨道最小宽度（px），浏览器按容器宽自动换行（`auto-fill`）。与 `columns` 二选一，`columns` 优先 |
| `repeat` | `GridBreakpointValue<'fill' \| 'fit'>` | `'fill'` | 内容驱动模式：`'fill'` 保留空轨道宽度一致；`'fit'` 折叠空轨道拉伸填满。仅配合 `minColWidth` 生效 |
| `maxCols` | `GridBreakpointValue<GridColumnCount>` | — | 内容驱动模式：封顶列数（1–12，超出钳制）。网格撑满父容器、实际存在的列总是填满整行。仅配合 `minColWidth` 生效 |
| `width` | `number \| string` | — | 容器宽度：数字=px，字符串原样（如 `'100%'`）。**不设时**：普通块级上下文下 `display: grid` 自动撑满父容器内容宽（无需设置）；但若父容器是 flex/grid 且交叉轴对齐不是 `stretch`（如 `layouts.page` 的 `align-items: center`），auto 宽度会 **shrink-wrap 收窄到内容宽**——此时需要显式 `width="100%"` |
| `height` | `number \| string` | — | 容器高度：数字=px，字符串原样 |
| `maxWidth` | `number \| string` | — | 最大宽度：数字=px，字符串原样 |
| `minHeight` | `number \| string` | — | 最小高度：数字=px，字符串原样 |
| `gap` | `GridBreakpointValue<SpacingStep>` | — | 行/列统一间距：单值或断点对象（1 = 4px，2 = 8px…；0.5/1.5 = 2px/6px）。断点对象见「断点值」 |
| `rowGap` | `GridBreakpointValue<SpacingStep>` | — | 行间距，覆盖 `gap` 的行轴（支持断点） |
| `columnGap` | `GridBreakpointValue<SpacingStep>` | — | 列间距，覆盖 `gap` 的列轴（支持断点；`maxCols` 封顶的 perColumn 计算用对应断点档位） |
| `padding` | `GridBreakpointValue<SpacingStep>` | — | 四边统一内边距（1 = 4px，2 = 8px…；0.5/1.5 = 2px/6px）。根元素已显式 `box-sizing: border-box`，与 `width`/`maxWidth` 叠加时 padding 计入宽度内 |
| `paddingX` | `GridBreakpointValue<SpacingStep>` | — | 水平内边距（`padding-inline`，左右，RTL 自动镜像）；与 `padding` 同传时覆盖其水平轴（垂直轴仍用 `padding`/`paddingY`） |
| `paddingY` | `GridBreakpointValue<SpacingStep>` | — | 垂直内边距（`padding-block`，上下）；覆盖 `padding` 的垂直轴 |
| `rowHeight` | `GridBreakpointValue<number>` | — | 隐式行轨道高度（px，`grid-auto-rows: Npx` 固定）——配 `GridSpan rows` 做瀑布流；支持断点 |
| `minRowHeight` | `GridBreakpointValue<number>` | — | 隐式行轨道最小高度（px，`grid-auto-rows: minmax(Npx, auto)`），行随内容增高；支持断点；与 `rowHeight` 同传时优先 |
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

// 内容驱动：每列至少 280px，浏览器自动换行（无需媒体查询）
<Grid minColWidth={280} gap={5}>
  <For each={cards}>{(c) => <Card>…</Card>}</For>
</Grid>

// auto-fit：条目少时拉伸填满整行（对比上方 auto-fill 保持等宽）
<Grid minColWidth={250} repeat="fit" gap={4}>…</Grid>

// maxCols 封顶：最多 3 列，但不足 3 列时（移动端单列）仍撑满整行
<Grid minColWidth={250} maxCols={3} gap={4}>…</Grid>

// minColWidth/maxCols 也支持断点：手机窄列 / 桌面宽列
<Grid minColWidth={{ base: 80, [TABLET]: 120, [DESKTOP]: 160 }} maxCols={{ base: 4, [DESKTOP]: 8 }} gap={2}>…</Grid>

// 瀑布流：最小行高（行随内容增高）或固定行高，均可断点化
<Grid columns={4} minRowHeight={80} gap={4}>
  <GridSpan rows={4}><Card style={{ height: "100%" }}>高条目</Card></GridSpan>
</Grid>

// 行列不同间距
<Grid columns={3} rowGap={2} columnGap={6}>…</Grid>

// 容器内边距（配合断点列数，卡片墙不贴边）
<Grid columns={{ base: 4, tablet: 8, desktop: 12 }} padding={2} gap={2}>…</Grid>

// 只设左右边距（页面级左右留白，RTL 自动镜像）；上下用 paddingY 或不动
<Grid columns={4} paddingX={4} gap={2}>…</Grid>

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
import { TABLET, DESKTOP } from "@dailogues/ui/theme.stylex.const"; // 断点常量 key

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
    <Grid
      columns={{ base: 4, [TABLET]: 8, [DESKTOP]: 12 }}
      gap={{ base: 1, [TABLET]: 2, [DESKTOP]: 4 }} // 间距也随断点变化
      padding={{ base: 1, [DESKTOP]: 4 }} // 桌面加内边距，手机/平板继承 base
    >
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
- **内边距**：`padding={2}` 给容器加 8px 内边距（SpacingStep 档位），卡片墙不贴边；与断点列数、gap 互不影响

## 无障碍

- Grid 是纯布局容器（`div`），**不添加任何角色/ARIA**：语义由内容决定（卡片列表外层用 `role="list"` + 子项 `role="listitem"` 或直接用普通 div）
+- 与 Astryx 一致：`display: grid` 不改变元素的阅读顺序（源码顺序 = DOM 顺序），键盘导航不受影响
- 所有原生属性透传，需要时可自行加 `aria-label` 等

## 与 Astryx 原版的差异

1. **API 形态**：Solid 回调 `ref`（非 React `ref` 对象）；`className`/`class` 等价；`style` 为 `CSSProperties` 对象
2. **间距档位**：Astryx 的 `--spacing-0/-0-5/…` 变量映射为 `theme.stylex` 的 `dimensions.spacingN`（整数档）；0.5/1.5 档（2px/6px）无 token，按 dialog 惯例内联（封顶 calc 里也内联）
3. **无 `themeProps`/`astryx-grid` 主题类名**：本站样式统一走 `xstyle` + tokens，不输出 Astryx 的 theming 目标类名（`astryx-grid`/`astryx-grid-span`）
4. **无 Layer 系统**：Grid 本身不需要；涉及弹层的用法请参考本站 dialog/popover 体系
5. **列数上限 12**（原版无限制）：新增 `GRID_MAX_COLUMNS` / `GridColumnCount`，固定列数、内容驱动 `maxCols`、`GridSpan` 跨列均钳制到 1–12
6. **内置断点值 `GridBreakpointValue`**（原版无）：`columns`/`minColWidth`/`repeat`/`maxCols`/`gap`/`rowGap`/`columnGap`/`padding`/`paddingX`/`paddingY`/`rowHeight`/`minRowHeight` 十二个属性均可传 `{base, [TABLET]?, [DESKTOP]?}`（或 `tablet`/`desktop` 字符串别名），缺省向小断点继承；key 用项目 `theme.stylex.const` 的 `TABLET`/`DESKTOP` 常量
7. **列配置拆分**（原版为 `columns={{minWidth, max, repeat}}` 单一对象）：本站拆成独立属性 `minColWidth`/`repeat`/`maxCols`，`columns` 只保留列数。**迁移**：`columns={{minWidth: 280}}` → `minColWidth={280}`；`columns={{minWidth: 250, max: 3, repeat: "fit"}}` → `minColWidth={250} maxCols={3} repeat="fit"`（旧写法在类型上直接报错，运行时安全回退单列）

## 已知限制

1. **断点对象/内容驱动时轨道模板是运行时字符串**：Solid 中改为响应式变化（如根据状态改 `minColWidth` 或断点列数）会重新生成模板并更新 CSS 变量——正常，但频繁切换无意义
2. **`repeat: 'fit'` + `maxCols` 同时用时**，`auto-fit` 的空轨道折叠与封顶 calc 并存，行为由浏览器决定（与 Astryx 一致，未做额外处理）
4. **无 `maxRows`**：CSS Grid 无原生「行数上限」；「只显示前 N 行」是裁剪语义（`max-height` + `overflow: hidden`，需按行高/gap 计算），建议在消费侧用外层容器实现，未内置
3. **`gap` 参与封顶 calc**：`columnGap` 优先于 `gap` 计入 perColumn 公式（与 Astryx 一致）；两个都传时封顶宽度按 `columnGap` 计算

## 参考

- [Astryx Grid 文档](https://astryx.atmeta.com/components/Grid)（抓取日期 2026-08-19）
- [Grid.tsx / GridSpan.tsx / Grid.test.tsx（facebook/astryx, MIT）](https://github.com/facebook/astryx/tree/main/packages/core/src/Grid)