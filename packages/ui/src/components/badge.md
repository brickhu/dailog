# Badge 徽章

两站共享的只读状态/分类指示器（studio 工作台 + site 消费端），用于在 glance 级别高亮一个**状态**（Active、Failed）或**分类标签**（Engineering、Design）。复刻自 [Astryx Badge](https://astryx.atmeta.com/components/Badge)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` tokens（`colors` / `dimensions`）。

> **使用克制**：每个徽章都在抢夺注意力——只在需要用户注意或行动的状态（错误、警告、待办）上使用；时间/时长/计数等元数据应使用普通描述文本，而非徽章。

- 源文件：`packages/ui/src/components/badge.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`（无新增依赖）

```tsx
import { Badge } from "@dailogues/ui";
```

## Props 接口

### 内容

| Prop | 类型 | 必填/默认 | 说明 |
|---|---|---|---|
| `label` | `JSX.Element` | 必填 | 徽章内容（文字或数字；也可传任意 JSX）。建议一两个词 |
| `icon` | `JSX.Element` | — | 可选**前置**图标（渲染于 label 之前，原样透传，不染色、不控制尺寸；项目 `Icon` 建议传 `width`/`height`，省略时按 1em=12px 继承字号） |

### 形态

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `variant` | `"neutral" \| "info" \| "success" \| "warning" \| "error"` | `"neutral"` | 视觉样式变体（语义档：实色底 + 对比文字） |

> **变体取舍**：Astryx 原组件还有 9 个非语义彩色变体（blue/cyan/green/orange/pink/purple/red/teal/yellow，33% 透明 tint 底 + 彩色文字），因项目 `theme.stylex.ts` 现有色板无对应色相 token、且按决定不为此新增 token，故本次复刻只保留 5 个语义档。如需扩展，在 `theme.stylex.ts` 补充 tint 色对后按 `variantStyles` 模式追加即可。

### HTML 透传

其余原生 `<span>` 属性（`aria-*`、`data-*`、`id`、`ref` 等）透传。

### 样式注入（三条通道）

| Prop | 说明 | 优先级 |
|---|---|---|
| `style` | 内联样式（页面级微调） | 最高（内联） |
| `xstyle` | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** | 覆盖内部 |
| `class` / `className` | 外部 CSS 类，与内部 stylex 类名**拼接共存**（不覆盖） | 层叠取决于样式表顺序 |

## 变体配色（token 映射）

Astryx 语义（accent/success/warning/error/neutral 实色底）映射到 `theme.stylex` 的既有色板；文字用各状态底色的对比色，随 dark mode 自动切换：

| variant | 底色（Astryx → 项目 token） | 文字色 |
|---|---|---|
| `neutral` | `colors.neutral` | `colors.onNeutral` |
| `info` | `colors.secondary`（accent → secondary 蓝系） | `colors.onSecondary` |
| `success` | `colors.success` | `colors.onSuccess` |
| `warning` | `colors.warning` | `colors.onWarningWeak` 的 default 值（深色 `#211e0c`；`onWarning` 白色对琥珀底对比度不足，深色文字与 Astryx on-warning 一致）。dark 模式用媒体查询锁定该深色值——`onWarningWeak` 的 dark 值（`#ede3a9` 浅黄）对同色相琥珀底几乎不可见 |
| `error` | `colors.danger` | `colors.onDanger` |

## 视觉结构

- 根元素 `<span>`：只读指示器，**非交互**（不可点击、无 focus、无键盘操作）——需要用户操作的场景请用 Button / link
- 结构：可选前置 `icon` + `label`（渲染顺序与参考实现一致）

基础样式 token 映射（Astryx Badge base 全量对应）：

| 样式 | 项目 token | 值 |
|---|---|---|
| 高度 | `dimensions.spacing5` | 20px（Astryx `--spacing-5`） |
| 横向 padding | `dimensions.spacing2` | 8px |
| icon-label 间距 | `dimensions.spacing1` | 4px |
| 圆角 | `dimensions.radiusFull` | 9999px（胶囊） |
| 字号 | `dimensions.fontSizeXs` | 12px（Astryx text-supporting） |
| 行高 | — | 1.6667（text-supporting-leading） |
| 字重 | `dimensions.fontWeightMedium` | 500 |
| 字体 | `inherit` | 继承上下文 |

## 使用示例

```tsx
import { Badge, Icon } from "@dailogues/ui";

// 基础（默认 neutral）
<Badge label="Badge" />

// 状态语义（只在需要用户注意时用）
<Badge variant="success" label="Active" />
<Badge variant="error" label="Failed" />
<Badge variant="warning" label="Action Required" />
<Badge variant="info" label="Info" />

// 分类标签 + 前置图标
<Badge variant="neutral" label="Engineering" />
<Badge
  variant="success"
  label="Verified"
  icon={<Icon icon="mdi:check" width={14} height={14} />}
/>

// 数字/计数（仍建议普通文本）
<Badge variant="error" label="3" />
```

## 无障碍行为

- **纯文本指示**：与参考实现一致，根元素不设 ARIA role（Badge 是只读内容，状态语义由所在容器——表格/列表/标题等——承担）；如需向屏幕阅读器播报状态变化，在容器上使用 `aria-live`/`role="status"`
- **图标**：`icon` 为可选装饰性内容，原样渲染；若图标无文字替代信息，建议外层加 `aria-hidden` 或仅作装饰
- **对比度**：实色底 + 各状态 `on{status}` 对比文字（warning 用深色 `onWarningWeak`，保证琥珀底上 WCAG AA）
- **非交互**：不可聚焦、不可点击——需要操作的场景应使用 Button / link（参考实现 best practice）

## 已知限制

1. **仅 5 个语义变体**：Astryx 的 9 个非语义彩色变体未复刻（项目色板无对应色相 token，按决定不新增）；`BadgeVariant` 类型为 `"neutral" | "info" | "success" | "warning" | "error"`。
2. **图标尺寸由调用方控制**：`icon` 原样透传；项目 `Icon` 省略尺寸时按 1em=12px（徽章字号）渲染，如需要更大可传 `width`/`height`。
3. **`label` 无默认值**：与参考实现一致为必填；文本建议 1–2 个词，更多细节放周边文本。
4. **不自动注入 ARIA role**：纯文本指示（与参考实现一致）；需要播报的场景由容器承担。
