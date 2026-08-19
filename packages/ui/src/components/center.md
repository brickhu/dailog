# Center 居中容器

两站共享的 flex 居中容器（studio 工作台 + site 消费端）。复刻自 [Astryx Center](https://astryx.atmeta.com/components/Center)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现（[github.com/facebook/astryx](https://github.com/facebook/astryx)）；技术栈为 **Solid + StyleX**，间距视觉值全部引用 `theme.stylex` tokens（`dimensions.spacingN`）。

- 源文件：`packages/ui/src/components/center.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`；间距档位类型复用 `./dialog` 的 `SpacingStep`，无新增依赖

## 设计思想

Center 是**纯 CSS flex 居中容器**（`display: flex` / `display: inline-flex`），不做任何 JS 布局计算：

- **方向（`axis`）**：`both`（默认）同时水平+垂直居中；`horizontal` 仅 `justify-content: center`（垂直方向保持默认 stretch）；`vertical` 仅 `align-items: center`（水平方向保持默认 stretch）。实现是两条独立规则按轴组合，与 Astryx 参考实现逐条对齐
- **`isInline`**：切换为 `inline-flex`——文本行内居中图标/徽章而不破坏行内流（Astryx docs 的典型用法："Text with inline centered icon"）
- **尺寸走内联**：`width` / `height` / `maxWidth` / `minHeight` 数字=px、字符串原样（如 `'100%'`），与 Grid 同一惯例（显式调用方设定，xstyle 不必覆盖）
- **垂直居中需要显式高度**：flex 容器高度不定时 `align-items` 无参照（Astryx best practice："Set a height when centering vertically"）
- **内边距档位**：`padding` 四边统一；`paddingInline` / `paddingBlock` 分别覆盖水平/垂直轴（同 Astryx 的 `paddingInline ?? padding` 语义）。档位复用 dialog 的 `SpacingStep`（0.5/1.5 = 2px/6px，token 无此档位）

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `axis` | `'both' \| 'horizontal' \| 'vertical'` | `'both'` | 居中方向：双轴（默认）/ 仅水平 / 仅垂直 |
| `width` | `number \| string` | — | 容器宽度：数字=px，字符串原样（如 `'100%'`） |
| `height` | `number \| string` | — | 容器高度：数字=px，字符串原样（垂直居中必需） |
| `maxWidth` | `number \| string` | — | 最大宽度：数字=px，字符串原样 |
| `minHeight` | `number \| string` | — | 最小高度：数字=px，字符串原样 |
| `padding` | `SpacingStep`（`0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10`） | — | 四边内边距（1 = 4px，2 = 8px…；0.5/1.5 = 2px/6px），显式 `padding={0}` 也生效 |
| `paddingInline` | `SpacingStep` | — | 水平内边距，覆盖 `padding` 的水平轴 |
| `paddingBlock` | `SpacingStep` | — | 垂直内边距，覆盖 `padding` 的垂直轴 |
| `isInline` | `boolean` | `false` | 用 `inline-flex`（文本行内居中图标/徽章） |
| `children` | `JSX.Element` | — | 要居中的内容（卡片、表单、spinner、空状态等） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（`stylex.create` 产物），最后合并、冲突时覆盖内部 |
| `className` / `class` | `string` | — | 外部 CSS 类，与内部 stylex 类名拼接共存 |
| `style` | `CSSProperties` | — | 根元素内联样式（与内部尺寸合并，页面级微调） |
| `ref` | `(el: HTMLDivElement) => void` | — | 根元素引用（Solid 回调） |
| `data-testid` | `string` | — | 测试选择器 |

其余原生属性（`id`、`aria-*`、`data-*`、`on*` 事件等）透传给根元素。

## 使用示例

```tsx
import { Center } from "@dailogues/ui";

// 双轴居中（空状态 / 加载屏 / 登录表单）：容器必须有确定高度
<Center width="100%" height={240}>
  <Spinner />
</Center>

// 仅水平居中（内容高度自适应）
<Center axis="horizontal" width="100%">
  <p>横向居中，纵向 stretch</p>
</Center>

// 仅垂直居中（宽度自适应内容）
<Center axis="vertical" height={200}>
  <Card>垂直居中卡片</Card>
</Center>

// 文本行内居中图标/徽章（inline-flex，不破坏行内流）
<p>
  欢迎回来 <Center isInline padding={1}><Icon icon="mdi:check" /></Center> 已登录
</p>

// 内边距：paddingInline / paddingBlock 各自覆盖 padding 的同轴值
<Center height={200} padding={2} paddingInline={6} width="100%">
  <div>左右 24px、上下 8px 的内边距</div>
</Center>

// 尺寸 + 外部样式
const styles = stylex.create({ panel: { border: "1px dashed" } });
<Center width={300} height={200} xstyle={styles.panel}>…</Center>
```

## 无障碍

- Center 是纯布局容器（`div`），**不添加任何角色/ARIA**：语义由内容决定（空状态建议配 `Heading`/`Text` 说明；纯装饰图标加 `aria-hidden`）
- 与 Astryx 一致：flex 不改变阅读顺序（源码顺序 = DOM 顺序），键盘导航不受影响
- 所有原生属性透传，需要时可自行加 `aria-label` 等

## 与 Astryx 原版的差异

1. **API 形态**：Solid 回调 `ref`（非 React `ref` 对象）；`className`/`class` 等价；`style` 为 `CSSProperties` 对象
2. **间距档位**：Astryx 的 `--spacing-0/-0-5/…` 变量映射为 `theme.stylex` 的 `dimensions.spacingN`（整数档）；0.5/1.5 档（2px/6px）无 token，按 dialog 惯例内联
3. **无 `themeProps`/`astryx-center` 主题类名**：本站样式统一走 `xstyle` + tokens，不输出 Astryx 的 theming 目标类名（`astryx-center`、`data-axis`）
4. **尺寸实现**：原版用 StyleX 动态样式（`--x-width` 等 CSS 变量间接层）；本站按 Grid 惯例直接内联（尺寸是显式调用方设定，xstyle 不必覆盖，且能避免内联变量被类覆盖的歧义）
5. **无 StyleX `xstyle` 之外的 React 专属 props**（如 `className` 类型差异）；行为测试（display flex/inline-flex、padding 档位、尺寸透传、props 透传、ref 转发）与原版 `Center.test.tsx` 逐条对齐

## 已知限制

1. **垂直居中必须显式 `height`/容器高度**：高度不定时 `align-items: center` 无参照，内容贴着顶部（Astryx 同限制）
2. **`isInline` + 尺寸**：inline-flex 容器设 `width`/`height` 时按内容收缩到设定值，不会撑满父容器（需要撑满请用块级 `display: flex` 或 `xstyle` 覆盖 `width: 100%`）
3. **padding 与内容溢出**：padding 不参与 flex 主轴尺寸计算，超大内容可能溢出（Astryx 同限制，未做额外处理）

## 参考

- [Astryx Center 文档](https://astryx.atmeta.com/components/Center)（抓取日期 2026-08-19）
- [Center.tsx / Center.doc.mjs / Center.test.tsx（facebook/astryx, MIT）](https://github.com/facebook/astryx/tree/main/packages/core/src/Center)
- [padding.stylex.ts（facebook/astryx, MIT）](https://github.com/facebook/astryx/blob/main/packages/core/src/Layout/padding.stylex.ts)
