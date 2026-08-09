# Button 按钮

两站共享的基础按钮（studio 工作台 + site 消费端）。复刻自 [Astryx Button](https://astryx.atmeta.com/components/Button)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` 非废弃 tokens（`colors` / `dimensions` / `durations` / `fontfamilies`）。

- 源文件：`packages/ui/src/components/button.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`（无新增依赖）

```tsx
import { Button } from "@dailogues/ui";
```

## Props 接口

### 外观

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "brand" \| "neutral" \| "danger" \| "warning" \| "success"` | `"primary"` | 语义色变体，对应 `colors.primary/secondary/brand/neutral/danger/warning/success` |
| `appear` | `"fill" \| "outline" \| "ghost"` | `"fill"` | 外观：实心 / 描边 / 透明 |
| `size` | `"sm" \| "md" \| "lg" \| "xl" \| "xxl"` | `"md"` | 尺寸档位（固定高度 24/32/40/48/56px） |
| `round` | `"sm" \| "md" \| "lg" \| "full" \| "none"` | 随尺寸：`sm` 尺寸为 `"sm"`，其余为 `"md"` | 圆角档位（radiusSm/Md/Lg/Full/0） |
| `elevation` | `"none" \| "low" \| "med" \| "high"` | `"none"` | 悬浮阴影层级（FAB 用；`ButtonGroup` 内由组拥有） |

**variant × appear 组合视觉**：

| appear | fill（实心） | outline（描边） | ghost（透明） |
|---|---|---|---|
| 默认态 | `{variant}` 底 + `on{variant}` 字 | 1px `{variant}` 描边 + `{variant}` 字 | `{variant}` 字 |
| hover | `*Strong`（加深/提亮） | `*Weak` 底色 | `*Weak` 底色 |

hover 高亮在禁用态（原生 `disabled` 或 `aria-disabled`）下不生效。

### 内容

| Prop | 类型 | 说明 |
|---|---|---|
| `label` | `string` | 可访问名。默认渲染为可见文本；`isIconOnly` 时用作 `aria-label`。兼容层：省略时回退为 `children` 文本 |
| `children` | `JSX.Element` | 可见文本覆盖（`label` 仍为可访问名）；省略时用 `label` 自身 |
| `icon` | `JSX.Element` | 前置图标（渲染于文本前，尺寸随 `size`：xs=12 / sm~md=16 / lg~xl=20 / xxl=24px） |
| `endContent` | `JSX.Element` | 尾部内容（badge/chevron 等），`isIconOnly` 时忽略 |
| `isIconOnly` | `boolean` | 仅图标：方形布局（1:1）+ `label` 作 `aria-label` |

### 行为

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `onClick` | `(e: MouseEvent) => void` | — | 点击回调 |
| `clickAction` | `(e: MouseEvent) => void \| Promise<void>` | — | 异步点击动作：pending 期间自动 loading；同 tick 双击防重 |
| `isLoading` | `boolean` | `false` | 加载态：spinner 覆盖内容 + 禁用 + live region 播报「加载中」 |
| `isInterruptible` | `boolean` | `false` | `clickAction` 进行中保持可点击/可打断（不禁用、不防重，spinner 与 `aria-busy` 仍显示） |
| `isDisabled` | `boolean` | `false` | 禁用（opacity 0.5 + not-allowed + 无 hover 高亮） |
| `tooltip` | `string` | — | 悬浮提示：hover/focus 显示于按钮上方（自绘，80ms 延迟动画）；禁用时自动切 `aria-disabled` 保持可聚焦 |
| `onKeyDown` | `(e: KeyboardEvent) => void` | — | 键盘事件（`aria-disabled` 时 Enter/Space 被抑制，其余键放行） |
| `href` | `string` | — | 提供时渲染为 `<a>`（支持 `target`/`rel`）；禁用时回落为 `<button>` |

### 表单与 HTML 透传

`type`（默认 `"button"`，`"submit"`/`"reset"`）、`name`、`value`、`form` 直接透传给原生 `<button>`；其余原生属性（`aria-*`、`data-*`、`id` 等）与 `aria-describedby` 均透传。

### 样式注入（三条通道）

| Prop | 说明 | 优先级 |
|---|---|---|
| `style` | 内联样式（页面级微调，与 `width` 合并） | 最高（内联） |
| `xstyle` | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** | 覆盖内部 |
| `class` / `className` | 外部 CSS 类，与内部 stylex 类名**拼接共存**（不覆盖） | 层叠取决于样式表顺序 |

```tsx
import * as stylex from "@stylexjs/stylex";

const pageStyles = stylex.create({
  cta: { marginTop: "24px", fontWeight: "700" },
});

<Button label="保存" xstyle={pageStyles.cta} />   // 同名属性（fontWeight）覆盖内部
<Button label="保存" class="my-btn" />             // 类名拼接，互不覆盖
```

## 尺寸与圆角

| size | 高度 | 字号 | 左右内边距 |
|---|---|---|---|
| `sm` | 24px（`sizeSm`） | 12px（`fontSizeXs`） | 12px（`spacing3`） |
| `md` | 32px（`sizeMd`） | 14px（`fontSizeSm`） | 12px |
| `lg` | 40px（`sizeLg`） | 14px | 16px（`spacing4`） |
| `xl` | 48px（`sizeXl`） | 16px（`fontSizeMd`） | 20px（`spacing5`） |
| `xxl` | 56px（`size2xl`） | 16px | 24px（`spacing6`） |

> `xxl` 依赖 `theme.stylex` 中 `dimensions.size2xl`（56px）——若主题缺少该 token 需补充。

| round | 圆角 |
|---|---|
| `sm` | 4px（`radiusSm`）——`size="sm"` 的默认 |
| `md` | 8px（`radiusMd`）——其余尺寸的默认 |
| `lg` | 12px（`radiusLg`） |
| `full` | 9999px（`radiusFull`） |
| `none` | 0（`radius0`） |

## 使用示例

```tsx
// 基础（默认 primary + fill + md）
<Button label="保存" />

// 语义色 × 外观
<Button label="取消" appear="ghost" />
<Button label="加入购物车" variant="brand" appear="outline" />
<Button label="次要操作" variant="neutral" />
<Button label="删除" variant="danger" />
<Button label="保存成功" variant="success" />
<Button label="注意" variant="warning" appear="ghost" />

// 尺寸与圆角
<Button label="小" size="sm" round="full" />
<Button label="大号圆角" size="xl" round="lg" />

// 异步动作：自动 loading + 防重复点击
<Button label="发布" clickAction={async () => { await publish(); }} />

// 显式加载态
<Button label="提交" isLoading={submitting()} />

// 可打断动作（如切换开关，允许重复触发）
<Button label="发送" isInterruptible clickAction={send} />

// 图标按钮（label 作为无障碍名）
<Button label="刷新" icon={<RefreshIcon />} isIconOnly />
<Button label="通知" icon={<BellIcon />} endContent={<span>3</span>} />

// 悬浮提示（hover / Tab 聚焦显示）
<Button label="删除" tooltip="删除后不可恢复" />

// 链接形态（禁用时自动回落为 button）
<Button label="查看文档" href="/docs" target="_blank" />

// 整行撑满
<Button label="确认入库" block />
<Button label="确认入库" width="100%" />
```

## 兼容层（旧 API）

以下旧属性仍可用，新代码请使用新 API：

| 旧写法 | 新写法 |
|---|---|
| `children` 作为唯一文本 | `label`（children 仍可覆盖可见文本） |
| `disabled` | `isDisabled` |
| `block` | `width="100%"` |
| `variant="ghost"` | `appear="ghost"` |
| `variant="danger"` | 现在是原生变体，直接使用（`danger` 语义色） |

## 无障碍行为

- **可访问名**：`label` 优先；`isIconOnly`、loading（非图标）、`children` 覆盖 `label` 三种场景自动补 `aria-label`
- **加载播报**：`role="status" aria-live="polite"` 播报「加载中」，同时 `aria-busy="true"`
- **禁用语义**：普通禁用用原生 `disabled`；带 `tooltip` 的禁用用 `aria-disabled`（保持键盘可聚焦以触达提示）
- **焦点**：`:focus-visible` 2px 变体色 outline + 3px offset
- **动效**：loading 防闪延迟与按压缩放均尊重 `prefers-reduced-motion`
- **键盘**：`aria-disabled` 时抑制激活键（Enter/Space），其余键透传

## 已知限制

1. **StyleX 0.19 不支持 `border` shorthand**（`property-specificity` 模式静默丢弃、不报错）。外部 `xstyle` 中写边框请用 `borderWidth` + `borderStyle` + `borderColor` 三个 longhand。
2. **图标尺寸**：`icon` 尺寸随档位缩放（sm~md=16 / lg~xl=20 / xxl=24px），emoji 文本图标除外。
3. **`class` 拼接语义**：`class` 与内部类名共存；若需覆盖内部样式属性，请用 `xstyle`（同名属性确定覆盖）或 `style`（内联，最高优先级）。
4. **tooltip 定位**：自绘 tooltip 绝对定位于按钮正上方，若祖先容器 `overflow: hidden` 且按钮贴边，气泡可能被裁剪。
