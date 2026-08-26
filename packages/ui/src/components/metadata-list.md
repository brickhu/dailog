# MetadataList 元数据键值列表

两站共享的只读键值元数据列表组件（studio 工作台 + site 消费端）。复刻自 [Astryx Metadata List](https://astryx.atmeta.com/components/MetadataList)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现 `github.com/facebook/astryx/packages/core/src/MetadataList`；技术栈为 **Solid + StyleX**，变量引用 `theme.stylex` 的 `colors`/`dimensions` tokens。

- 源文件：`packages/ui/src/components/metadata-list.tsx`、`packages/ui/src/components/metadata-list-item.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`、`@dailogues/i18n`（新增词典键 `metadataList.showMore` / `metadataList.showLess`，zh/en 双语）
- 语义结构：根 div（`astryx-metadata-list` + `data-columns`/`data-orientation`）+ 可选标题 + `<dl>`（`<dt>` 标签 / `<dd>` 值，APG 键值对语义）+ 可选展开/收起按钮

```tsx
import { MetadataList, MetadataListItem } from "@dailogues/ui";
```

## 基本用法

```tsx
// 单列（默认：标签在左、值在右，baseline 对齐）
<MetadataList>
  <MetadataListItem label="Name">MetadataList</MetadataListItem>
  <MetadataListItem label="Status">Active</MetadataListItem>
  <MetadataListItem label="Owner">Joey</MetadataListItem>
</MetadataList>

// 多列自适应（标签堆叠在上方）
<MetadataList columns="multi" title={<h3>Details</h3>}>
  <MetadataListItem label="Author" icon={<Icon icon="user" />}>Joey</MetadataListItem>
  <MetadataListItem label="Published">2025-01-01</MetadataListItem>
</MetadataList>

// 固定 3 列 + 折叠（超过 3 条显示"显示更多"）
<MetadataList columns={3} maxNumOfItems={3}>
  {items}
</MetadataList>

// 横向流式（flex 换行，忽略 columns/label/maxNumOfItems）
<MetadataList orientation="horizontal">
  <MetadataListItem label="CPU">M3</MetadataListItem>
  <MetadataListItem label="RAM">16GB</MetadataListItem>
</MetadataList>
```

## Props 接口

### MetadataList

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `children` | `JSX.Element` | 必填 | 元数据条目（MetadataListItem 组件） |
| `columns` | `"single" \| "multi" \| number` | `"single"` | 列布局：single=单列 / multi=auto-fill（`minmax(280px,1fr)`）/ 数字=固定列数 |
| `label` | `{ position?: "start" \| "top", width?: number \| string }` | 单列 `{position:"start"}` / 多列 `{position:"top"}` | 标签位置与自定义标签列宽（width 仅侧标生效） |
| `maxNumOfItems` | `number` | — | 折叠前最多显示条目数；超出出现"显示更多/显示更少"（仅 vertical） |
| `orientation` | `"vertical" \| "horizontal"` | `"vertical"` | horizontal=flex 行换行（强制顶标，忽略其余布局 props） |
| `title` | `JSX.Element` | — | 列表上方标题 |
| `xstyle` | `StyleXStyles` | — | 外部 StyleX 样式，最后合并、冲突时覆盖 |
| `class` / `className` | `string` | — | 与内部 stylex 类名 + `astryx-metadata-list` 拼接 |
| 其余 | 原生 `div` 属性 | — | 透传（`ref`、`data-testid`、`aria-*` 等） |

### MetadataListItem

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `children` | `JSX.Element` | 必填 | 内容值（渲染在 `<dd>`） |
| `label` | `string` | 必填 | 标签文本（渲染在 `<dt>`） |
| `icon` | `JSX.Element` | — | 渲染在 label 前的图标 |
| `xstyle` | `StyleXStyles` | — | 外部 StyleX 样式 |
| `class` / `className` | `string` | — | 与内部类名 + `astryx-metadata-list-item` 拼接 |
| `data-testid` | `string` | — | 顶标模式落到包裹 div；侧标模式拆 `-label`/`-value` |

## 行为契约

- **语义**：`<dl>/<dt>/<dd>`；根容器 theming 类 `astryx-metadata-list`（visualProps：columns/orientation 以 `data-*` 暴露），条目类 `astryx-metadata-list-item`
- **标签位置**：单列默认 `start`（标签左、值右，`auto 1fr` + baseline 对齐）；多列默认 `top`（标签堆叠）；horizontal 强制 `top`
- **栅格**：单列侧标 `auto 1fr`（8/16px gap）；单列顶标 `1fr`（12px）；多列 `repeat(auto-fill, minmax(280px,1fr))`（16px）；数字列>1 → 顶标 `repeat(n,1fr)` / 侧标 `repeat(n, auto 1fr)`（运行时 inline）；自定义 label width（仅侧标）→ `'<width> 1fr'`
- **折叠**：`maxNumOfItems` 仅 vertical 生效；条目数超出时默认折叠，按钮 `aria-expanded` + `aria-controls`（指向 dl id），文案经 `useI18n()` 取 `metadataList.showMore/showLess`（zh：显示更多/显示更少；en：Show more/Show less）
- **条目计数**：`children()` + `toArray()`（过滤 null/undefined/boolean 并展平，同 React Children.toArray 语义）
- **图标**：`icon` 渲染在 label 前（inline-flex，muted 色）；lazy JSX prop 用 `children()` 包装防 hydration mismatch（同 Button）
- **Token 映射**：label 色 `onSurface` 60% 淡化（项目 muted 约定）、value 色 `colors.onSurface`、强调色 `colors.secondary`（项目 link/accent 约定）、字号 `fontSizeMd`（1rem）、字重 `fontWeightMedium`、minHeight `sizeSm`（24px）
