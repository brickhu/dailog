# Banner 横幅

两站共享的常驻状态横幅（studio 工作台 + site 消费端），用于系统级公告、状态与告警（表单错误、系统更新、维护通知、成功确认）。复刻自 [Astryx Banner](https://astryx.atmeta.com/components/Banner)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` tokens（`colors` / `dimensions` / `durations` / `easings` / `shadows`），图标使用项目已有的 `@iconify-icon/solid`（mdi 系列）。

- 源文件：`packages/ui/src/components/banner.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`、`@iconify-icon/solid ^3.0.3`（复用同目录 `./button`，无新增依赖）

```tsx
import { Banner } from "@dailogues/ui";
```

## Props 接口

### 内容与状态

| Prop | 类型 | 必填/默认 | 说明 |
|---|---|---|---|
| `status` | `"info" \| "warning" \| "error" \| "success"` | 必填 | 状态：控制图标、配色与 ARIA role（info/success→`status`，warning/error→`alert`） |
| `title` | `JSX.Element` | 必填 | 标题（以 `<div>` 渲染，可传任意内容） |
| `description` | `JSX.Element` | — | 标题下方描述（`<div>` 渲染） |
| `icon` | `JSX.Element` | 状态默认图标 | 覆盖默认状态图标（原样透传，不染色） |
| `endContent` | `JSX.Element` | — | 头部末端操作区（右对齐），通常是操作按钮 |
| `children` | `JSX.Element` | — | 折叠内容区：卡片底 + 三边描边；提供后头部出现展开/收起开关 |

### 行为

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `isDismissable` | `boolean` | `false` | 显示关闭按钮；横幅**自管理隐藏**，无需外部状态 |
| `onDismiss` | `() => void` | — | 关闭回调（无论是否提供，横幅都会自行隐藏） |
| `defaultIsExpanded` | `boolean` | `false` | `children` 初始是否展开（非受控，与参考实现一致） |

### 形态

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `container` | `"card" \| "section"` | `"card"` | card：独立圆角（内容区展开时头部只保留顶部圆角）；section：全宽无圆角，用于页面级横幅 |
| `elevation` | `"none" \| "low" \| "med" \| "high"` | `"none"` | 悬浮阴影层级（`shadows` token）；card 形态下阴影跟随圆角轮廓 |

### HTML 透传

其余原生 `<div>` 属性（`aria-*`、`data-*`、`id`、`ref` 等）透传；`title` 被占用为标题 prop（与 Astryx 一致）。

### 样式注入（三条通道）

| Prop | 说明 | 优先级 |
|---|---|---|
| `style` | 内联样式（页面级微调） | 最高（内联） |
| `xstyle` | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** | 覆盖内部 |
| `class` / `className` | 外部 CSS 类，与内部 stylex 类名**拼接共存**（不覆盖） | 层叠取决于样式表顺序 |

## 状态配色（token 映射）

Astryx 原语义（accent/warning/error/success muted 底 + text-primary/secondary 文字）映射到 `theme.stylex` 的既有色板；标题/描述/图标使用各状态底色的对比色（`on{status}Weak`），保证可读性，随 dark mode 自动切换：

| status | 底色（Astryx muted → 项目 token） | 文字/图标色 |
|---|---|---|
| `info` | `colors.secondaryWeak`（accent-muted） | `colors.onSecondaryWeak` |
| `warning` | `colors.warningWeak` | `colors.onWarningWeak` |
| `error` | `colors.dangerWeak` | `colors.onDangerWeak` |
| `success` | `colors.successWeak` | `colors.onSuccessWeak` |

端区按钮（展开/关闭）的文字/图标颜色与横幅文字一致（`on{status}Weak`）：通过 `xstyle` 覆盖 Button ghost 的 neutral 色，hover 底色为同色 12% 半透明 tint（选择器与 Button 内部 hover 完全一致，按既有 xstyle 约定覆盖）。

## 视觉结构

- 头部为定位上下文（`position: relative`）：
  - 状态图标 `absolute` 于左上角，左缘伸入 padding 区 4px（`calc(spacing4 - spacing1)`，不越过容器边缘），顶部与文本对齐
  - 端区（操作/展开/关闭）`absolute` 于右上角，右缘同样伸入 padding 区 4px（与左侧图标对称）
  - 文本区在两者之间：左端 `calc(spacing4 + spacing2)` 起，右端按端区条目数预留按钮宽度（单条目 28px / 多条目 60px；`endContent` 宽度按一个 sm 按钮近似）
- 标题/描述/图标均与头部顶端对齐；仅标题 + 操作时内容垂直居中

其余视觉 token 映射：

| 元素 | 项目 token |
|---|---|
| 内容区底色 | `colors.surface` |
| 内容区三边描边 | `ink` 15% 半透明（`color-mix`，与 button-group 分隔边框同一手法） |
| 圆角（card 容器） | `dimensions.radiusLg`（12px） |
| chevron 动画 | `durations.durationFast` + `easings.easeOut`，`prefers-reduced-motion` 下 0s |
| 阴影 | `shadows.shadowLow / shadowMed / shadowHigh` |
| 标题 / 描述 | 14px（`fontSizeSm`），semiBold / normal |

## 使用示例

```tsx
import { Banner, Button } from "@dailogues/ui";

// 基础状态
<Banner status="info" title="A new software update is available." />
<Banner
  status="error"
  title="Payment failed"
  description="Update your billing information to continue."
  isDismissable
  onDismiss={() => console.log("dismissed")}
/>

// 操作按钮 + 折叠内容（disclosure）
<Banner
  status="warning"
  title="Configuration changes detected"
  description="Review the changes before they take effect."
  endContent={<Button label="Review" variant="secondary" appear="outline" size="sm" />}
  isDismissable
>
  <ul>
    <li>Authentication method updated</li>
    <li>Rate limits modified</li>
  </ul>
</Banner>

// 初始展开 + 页面级横幅 + 悬浮阴影
<Banner status="warning" title="Trial ends soon" defaultIsExpanded>
  <p>Details here...</p>
</Banner>
<Banner status="success" title="Changes saved" container="section" elevation="low" />
```

## 无障碍行为

- **语义播报**：info/success → `role="status"`（轮询播报），warning/error → `role="alert"`（立即打断）
- **图标**：状态图标容器 `aria-hidden="true"`（装饰性）
- **折叠区（disclosure 模式）**：展开开关携带 `aria-expanded` 与 `aria-controls`（关联内容区 id）；`aria-controls` 仅在内容区挂载时引用，卸载后移除，无悬空引用
- **折叠动画**：内容区用 `grid-template-rows 0fr↔1fr` 高度动画 + 透明度（150ms `durationMediumMin` + `easeInOut`，纯 CSS 无需 JS 测高）；**收起动画结束后才从 DOM 卸载**（避免残留 0 高、仍可聚焦的内容），`prefers-reduced-motion` 下 0s 直接切换、立即卸载。两个宽度陷阱已处理：grid 只定义 rows 时隐式列为 auto（内容区缩成内容宽）→ 显式 `grid-template-columns: 1fr`；grid 子项 `justify-self: stretch` 实测不生效 → 显式 `width: 100%`（按 grid 区域解析）
- **按钮**：展开/关闭按钮复用项目 `Button`（ghost/sm/icon-only），文字/图标颜色随横幅文字（`on{status}Weak`，hover 同色 12% tint 底），`label` 作可访问名，`tooltip` 悬浮提示，`:focus-visible` 描边随按钮
- **动效**：挂载淡入 + 关闭淡出（150ms `durationMediumMin` + `easeInOut`，淡出结束后才卸载）、chevron 旋转（120ms `durationFast` + `easeOut`）、内容区高度动画，均尊重 `prefers-reduced-motion`
- **关闭**：点关闭后淡出再卸载（150ms）；`onDismiss` 无论是否提供，横幅都会自行隐藏

## 已知限制

1. **`title` prop 占用原生 `title` 属性**：横幅根元素无法再透传原生 title 提示（与 Astryx 一致）。
2. **开关/关闭按钮文案硬编码英文**（Collapse / Expand / Dismiss）：项目无 i18n 系统；如需改语言，修改 `banner.tsx` 内 `label`/`tooltip` 即可（展开/收起/关闭）。
3. **图标依赖 iconify**：默认状态图标为 `@iconify-icon/solid` + mdi 系列（`mdi:information-outline` / `mdi:check-circle` / `mdi:alert` / `mdi:alert-circle` / `mdi:chevron-down` / `mdi:close`），与项目现有用法一致；`icon` prop 可完全替换。
4. **非受控状态**：`isDismissed` / `isExpanded` 均为组件内部状态（与参考实现一致）；如需受控（如外部重置横幅），需上层按 key 重挂载。
5. **关闭淡出后布局回位**：淡出结束后横幅才从文档流移除，页面布局在移除瞬间跳变（未做整条高度坍缩动画）；如需整条平滑收起，可在 root 外包一层 `grid-template-rows` 高度动画。
6. **端区文本预留为近似值**：`endContent` 宽度按一个 sm 按钮近似预留（28/60px 两档）；若 `endContent` 明显更宽且文本很长，文本可能延伸至按钮下方。
