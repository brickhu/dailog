# Card 基础卡片容器

site 消费端的基础卡片容器（site-local 组件，与 ClickableCard 同目录——为保持两者的样式继承关系而留在 site，未放入共享 @dailogues/ui；Card 本身只渲染 div，无路由依赖）。**纯视觉容器：surface 底 + 1px 边框 + 圆角 + padding/elevation，无 variant 背景色变体、无任何交互语义**（无 cursor/hover/focus/disabled）。参照 [Astryx ClickableCard](https://astryx.atmeta.com/components/ClickableCard) 的视觉层实现，是 ClickableCard 的样式基底；技术栈 **Solid + StyleX**，视觉变量全部引用 `@dailogues/ui/theme.stylex` 非废弃 tokens（`colors` / `dimensions` / `shadows`）。

- 源文件：`apps/site/src/components/card.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`

```tsx
import { Card } from "./card";
```

## 与 ClickableCard 的关系（样式继承）

`ClickableCard = Card（容器/圆角/padding/elevation 继承）+ 自有 variant（背景色 + hover）+ 交互层（点击/导航）`：

| 层 | 归属 | 内容 |
|---|---|---|
| 视觉基底 | Card（导出 `cardStyles` / `cardPaddings` / `cardElevations`） | 圆角、surface 底 + 边框（`cardStyles.surface`，仅 Card）、padding 档位、elevation 阴影 |
| variant + 交互层 | ClickableCard（本文件不导出） | 背景色变体（含 hover 高亮 → `*Strong`）、cursor/transition、focus-visible、disabled、点击/导航语义（`href` → link / `onClick` → button） |

- 两者复用同一套 CSS 变量钩子（`--card-bg` / `--card-border` / `--card-bg-hover` / `--card-border-hover`；hover 变量仅在可点击卡片上生效）
- 静态内容用 **Card**；需要整卡可点/导航或背景色变体用 **ClickableCard**（多一个点击跳转功能）

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `children` | `JSX.Element` | — | 卡片内容（可自由嵌套任意元素） |
| `padding` | `0 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6 | 8 | 10` | `4` | 内边距档位 = spacing 步进 ×4px（`4`→16px） |
| `elevation` | `"none" | "low" | "med" | "high"` | `"none"` | 悬浮阴影层级 |
| `width` / `height` / `maxWidth` | `SizeValue = number | string` | — | 尺寸：数字=px，字符串原样（如 `"100%"`） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** |
| `class` / `className` | `string` | — | 外部 CSS 类，与内部 stylex 类名拼接共存（不覆盖） |
| rest | 原生 div 属性 | — | `data-*`、`onMouseEnter`、`id`、`role`（如 `role="article"` 语义化）等透传 |

> 背景色变体已从 Card 移除（统一 surface 底 + 边框）：需要彩色背景/变体请用 **ClickableCard** 的 `variant` prop。

## 使用示例

```tsx
// 静态信息卡（无交互语义：无 cursor/hover/focus）
<Card width={320} padding={4}>
  <h3>节目简介</h3>
  <p>每周更新的播客节目。</p>
</Card>

// 阴影 + 语义化 role
<Card elevation="med" maxWidth={320} role="article">
  <p>提示内容。</p>
</Card>

// 需要整卡可点/导航或背景色变体时换成 ClickableCard（继承本组件容器/圆角/padding/elevation）
<ClickableCard label="进入节目" href={"/episode/" + slug}>…</ClickableCard>
<ClickableCard label="重要" variant="orange" width={240}>…</ClickableCard>
```

## 主题化接口（样式契约）

| 钩子 | 说明 |
|---|---|
| 固定类 | `.dailog-card`（与 `class`/`className` 拼接） |
| data-attributes | `data-elevation`（供 CSS 选择器主题化） |
| CSS 变量 | `--card-bg`、`--card-border`（每项带默认值，外部可覆盖；`--card-bg-hover` / `--card-border-hover` 由 ClickableCard 交互层使用） |

```css
.dailog-card {
  --card-bg: #f0f2f2;
  --card-border: rgba(0, 0, 0, 0.12);
  border-radius: 12px; /* 覆盖 radiusXl 默认 */
}
```

## 已知限制

1. **无 variant/交互语义**：需要背景色变体或 hover/focus/点击/导航反馈请用 ClickableCard——Card 本身是静态容器。
2. **StyleX 0.19 不支持 `border` shorthand**：外部 `xstyle` 写边框请用 `borderWidth` + `borderStyle` + `borderColor` 三个 longhand。
3. **`class` 拼接语义**：外部类与内部类共存；覆盖内部属性请用 `xstyle`（确定覆盖）或 `style`（内联，最高优先级）。
