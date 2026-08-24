# ClickableCard 可点击卡片

site 消费端的可点击卡片（site-local 组件，未放入共享 @dailogues/ui——因 href 卡片依赖 @solidjs/router 的 `<A>` 做 SPA 导航，抽为公共组件会引入路由耦合）：**整卡是导航/单一操作的激活目标，嵌套交互元素独立工作**。复刻自 [Astryx ClickableCard](https://astryx.atmeta.com/components/ClickableCard)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现；技术栈为 **Solid + StyleX**，视觉变量全部引用 `@dailogues/ui/theme.stylex` 非废弃 tokens（`colors` / `dimensions` / `durations` / `shadows`）。

**样式继承**：`ClickableCard = Card（容器/圆角/padding/elevation 继承）+ 自有 variant（背景色 + hover）+ 交互层（点击/导航）`——容器与圆角（`cardStyles.base`）、padding 档位（`cardPaddings`）、elevation（`cardElevations`）复用 [Card](./card.md)（`card.tsx`）导出的样式对象与同一套 CSS 变量钩子（`--card-*`）；**variant 背景色变体（含 hover 高亮）为本组件自有**（Card 已去掉 variant，surface 底固定为基础样式）。本组件只负责交互层（hover 高亮 / focus / disabled / 点击导航）。静态内容用 Card，需整卡可点/导航或背景色变体用本组件。

- 源文件：`apps/site/src/components/clickable-card.tsx`（内部机制 `use-clickable-container.ts`；视觉基底继承 `card.tsx`）
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`、`@solidjs/router ^1.0`（href 卡片渲染 `<A>` 做 SPA）

```tsx
import { ClickableCard } from "./clickable-card";
import { useClickableContainer } from "./use-clickable-container";
```

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string`（必填） | — | 可访问名 → `aria-label` |
| `href` | `string` | — | 导航 URL：提供时卡片内部渲染 **@solidjs/router 的 `<A>`** —— 左键点击由 router 做 **SPA 导航**（SSR 水合前退化为原生 `<a>` 跳转；Enter/中键/Cmd+点击原生处理）。**无需再写 `onClick` + `navigate()` 接管** |
| `target` | `string` | `"_self"` | 链接目标（`href` 时生效） |
| `onClick` | `(e: MouseEvent) => void` | — | 点击处理：**仅在卡面触发**（命中嵌套交互元素时跳过）；`e.preventDefault()` 可接管导航（如用 router SPA 导航） |
| `isDisabled` | `boolean` | `false` | 禁用：`aria-disabled` + `tabIndex=-1` + 不响应点击/键盘 + opacity 0.5 |
| `children` | `JSX.Element` | — | 卡片内容（可自由嵌套 button/link 等交互元素） |
| `padding` | `0 | 0.5 | 1 | 1.5 | 2 | 3 | 4 | 5 | 6 | 8 | 10` | `4` | 内边距档位 = spacing 步进 ×4px（`4`→16px） |
| `variant` | `"default" | "transparent" | "muted" | "blue" | "cyan" | "gray" | "green" | "orange" | "pink" | "purple" | "red" | "teal" | "yellow"` | `"default"` | 背景色变体：`default` 带边框（hover 加深），其余无边框；彩色映射项目语义色板 |
| `elevation` | `"none" | "low" | "med" | "high"` | `"none"` | 悬浮阴影层级（常提升以暗示整卡可点） |
| `width` / `height` / `maxWidth` | `SizeValue = number | string` | — | 尺寸：数字=px，字符串原样（如 `"100%"`） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** |
| `class` / `className` | `string` | — | 外部 CSS 类，与内部 stylex 类名拼接共存（不覆盖） |
| rest | 原生 div 属性 | — | `data-*`、`onMouseEnter`、`id` 等透传 |

**variant 色板映射**（Astryx 12 色 → 项目语义色）：

| variant | 背景（`--card-bg` 默认） | hover（`--card-bg-hover` 默认） |
|---|---|---|
| `default` | `surface`（含 1px 边框） | `surfaceStrong` + 边框加深 |
| `transparent` | 透明 | `surfaceWeak` |
| `muted` | `surfaceWeak` | `surfaceStrong` |
| `blue` | `secondary` | `secondaryStrong` |
| `cyan` | `secondaryWeak` | `secondaryStrong` |
| `gray` | `neutral` | `neutralStrong` |
| `green` | `success` | `successStrong` |
| `orange` | `warning` | `warningStrong` |
| `pink` | `danger` | `dangerStrong` |
| `purple` | `primary` | `primaryStrong` |
| `red` | `danger` | `dangerStrong` |
| `teal` | `successWeak` | `successStrong` |
| `yellow` | `warningWeak` | `warningStrong` |

## 使用示例

```tsx
// 导航卡片（link 语义：Enter 激活，中键/Cmd/Ctrl+点击新标签页）
<ClickableCard label="查看产品详情" href="/products/42" width={320} elevation="low">
  <h3>无线耳机</h3>
  <p>30 小时续航的降噪耳机。</p>
</ClickableCard>

// 动作卡片 + 嵌套按钮独立工作（点按钮不触发卡片 onClick）
<ClickableCard label="设置" onClick={() => navigate("/settings")}>
  <p>点击卡片任意位置进入设置。</p>
  <Button label="删除" variant="danger" appear="ghost" />
</ClickableCard>

// SPA 导航卡片：只传 href，内部 <A> 由 router 接管 SPA（无需 onClick + navigate）
<ClickableCard label="进入节目" href={"/episode/" + slug}>
  <p>整卡点击走 SPA 路由（router 全局拦截锚点点击）。</p>
</ClickableCard>

// 禁用
<ClickableCard label="已锁定" href="/x" isDisabled>
  <p>不可交互。</p>
</ClickableCard>

// 变体与阴影
<ClickableCard label="提示" variant="muted" elevation="med" maxWidth={320}>…</ClickableCard>
<ClickableCard label="重要" variant="orange" width={240}>…</ClickableCard>
```

## useClickableContainer（可复用到任意容器）

整卡可点机制独立导出（Astryx 参考实现同款语义）：**让任意容器元素可点，同时保留嵌套交互元素**。

```tsx
import { useClickableContainer } from "./use-clickable-container";

function Tile(props: { label: string; href: string }) {
  const cc = useClickableContainer({
    getHref: () => props.href,
    getLabel: () => props.label,
  });
  return (
    <li
      role={cc.role()}
      tabIndex={cc.tabIndex()}
      aria-label={cc.ariaLabel()}
      aria-disabled={cc.ariaDisabled()}
      onClick={cc.handleClick}
      onKeyDown={cc.handleKeyDown}
      ref={cc.setRef}
    >
      {props.label}
    </li>
  );
}
```

| Option | 说明 |
|---|---|
| `getHref` / `getTarget` | 导航 URL 与目标（getter 形式：Solid props 变化时事件处理器读到最新值） |
| `getOnClick` | 表面点击处理（嵌套交互元素命中时跳过） |
| `getDisabled` | 禁用 |
| `getLabel` | 可访问名 |
| `getInteractiveSelector` | 嵌套交互元素选择器（默认 `DEFAULT_INTERACTIVE_SELECTOR`：a/button/input/select/textarea/summary/role 交互元素/contenteditable/iframe 等） |

## 主题化接口（样式契约）

| 钩子 | 说明 |
|---|---|
| 固定类 | `.dailog-clickable-card`（与 `class`/`className` 拼接） |
| data-attributes | `data-variant`、`data-elevation`（供 CSS 选择器主题化） |
| CSS 变量 | 与 Card 共用：`--card-bg`、`--card-border`（`default` 变体与 Card 表面一致；Card 的基础表面同用这两项）、`--card-bg-hover`、`--card-border-hover`（交互层 hover，仅可点击卡片生效；每项带默认值，外部可覆盖） |

```css
.dailog-clickable-card {
  --card-bg: #f0f2f2;
  --card-bg-hover: #e2e6e6;
  border-radius: 12px; /* 覆盖 radiusXl 默认 */
}
```

## 无障碍行为

- **可访问名**：`label` 必填 → `aria-label`
- **角色**：`href` → `role="link"`（Enter 激活；中键/Cmd/Ctrl+点击新标签页）；仅 `onClick` → `role="button"`（Enter + Space 激活）；禁用/无动作 → 无角色
- **禁用语义**：`aria-disabled="true"` + `tabIndex=-1`（键盘不可达）+ 不响应点击/键盘 + opacity 0.5 + not-allowed
- **焦点**：`:focus-visible` 2px `colors.primary` outline + 3px offset
- **嵌套交互**：点击命中嵌套交互元素（a/button/input/…）时卡片不激活；键盘仅容器自身聚焦时响应激活键（嵌套元素按键归其自身）
- **动效**：过渡尊重 `prefers-reduced-motion`；hover 高亮仅在 `@media (hover: hover)` 且非禁用态生效

## 已知限制

1. **href 卡片走 `<A>` SPA**：`href` 卡片内部渲染 @solidjs/router 的 `<A>`，左键点击由 router 全局锚点拦截做 SPA 导航（SSR 水合前退化为原生 `<a>` 跳转，不会出现"首次点击无响应"）；Enter/中键/Cmd+点击原生处理。消费方 `onClick` 直透锚点：`preventDefault()` 可接管（阻止 SPA）；不 preventDefault 则作为副作用先执行、随后仍 SPA。依赖：`@dailogues/ui` 需在 `<Router>` 内使用（site/studio 均已具备）。
2. **href 卡片内勿嵌套交互元素**：`<a>` 内再嵌 `<a>`/`<button>` 属无效 HTML，嵌套 button/link 等交互元素请用**非 href** 卡片（仅 `onClick`，渲染为 div）。
3. **StyleX 0.19 不支持 `border` shorthand**：外部 `xstyle` 写边框请用 `borderWidth` + `borderStyle` + `borderColor` 三个 longhand。
4. **`class` 拼接语义**：外部类与内部类共存；覆盖内部属性请用 `xstyle`（确定覆盖）或 `style`（内联，最高优先级）。
5. **键盘激活的 `onClick` 事件**：键盘激活时传入的触发源是键盘事件（非 `MouseEvent`），如需区分请检查 `e instanceof MouseEvent`。
