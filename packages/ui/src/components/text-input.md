# TextInput 文本输入框

两站共享的单行文本输入字段（studio 工作台 + site 消费端）。复刻自 [Astryx TextInput](https://astryx.atmeta.com/components/TextInput)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现 `github.com/facebook/astryx`；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` 非废弃 tokens。

- 源文件：`packages/ui/src/components/text-input.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`、`@dailogues/i18n`、`@iconify/utils`（Icon 按需拉取）（无新增依赖）
- 补充 i18n key：`field.clear`（清除按钮 aria-label，zh/en 已加入 `packages/i18n/src/dictionaries.ts`）

```tsx
import { TextInput } from "@dailogues/ui";
```

## 视觉规格（本仓库定制）

组件内部**所有颜色都变量化**：根元素声明一组 `--ti-*` CSS 变量（默认值取自 `theme.stylex` tokens），内部样式全部引用这些变量，外部可整体配置颜色。

| 变量 | 默认值 | 控制 |
|---|---|---|
| `--ti-bg` | `colors.surface` | 输入容器底色 |
| `--ti-border` | `colors.surfaceStrong` | 输入容器边框、清除/图标按钮 hover 底与描边 |
| `--ti-text` | `colors.onSurface` | 输入文本、标签、聚焦边框与光环 |
| `--ti-muted` | `--ti-text` 60%（派生） | 描述、选填标记 |
| `--ti-focus-bg` | `--ti-bg` 与 `--ti-text` 的 94/6 混色（派生） | focus-within 时的容器底色 |
| `--ti-error` | `colors.danger` | error 状态（边框/图标/消息框整套） |
| `--ti-warning` | `colors.warning` | warning 状态 |
| `--ti-success` | `colors.success` | success 状态 |

占位符（`--ti-text` 55%）、聚焦底色（`--ti-focus-bg`）与状态消息框底色（状态色 12% 淡染）由主变量派生，覆盖 `--ti-text` / `--ti-bg` / 状态色会自动跟随。暗色模式无需额外处理：默认值 token 自带 `prefers-color-scheme: dark` 双态。

### 颜色覆盖（三种方式，任选其一）

```tsx
// ① colorVars prop（推荐）：作用于整个字段根元素，内联优先级最高
<TextInput label="邮箱" value={mail()} onChange={setMail}
  colorVars={{ "--ti-bg": "#ffffff", "--ti-border": "#d0d0d0", "--ti-text": "#161b22", "--ti-error": "#e00" }} />

// ② 祖先元素上设同名 CSS 变量（经继承生效，可整体换肤）
<div style={{ "--ti-bg": "#f7f7f7" }}>
  <TextInput label="搜索" value={q()} onChange={setQ} />
</div>

// ③ stylex 类 / CSS 规则（作用于根元素或祖先）
import * as stylex from "@stylexjs/stylex";
const brand = stylex.create({ input: { "--ti-bg": "#fff", "--ti-error": "#e00" } });
<TextInput label="邮箱" value={mail()} onChange={setMail} class={stylex.props(brand.input).className as string} />
```

类型：`TextInputColorVars` 由 barrel 导出（与 `LogoColorVars` 同模式），组件通过 `colorVars` prop 接收。

## Props 接口

### 受控值与内容

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `value` | `string` | — | 受控值 |
| `onChange` | `(value, e) => void` | — | 值变化回调（受控）；`changeAction` 可经 `e.defaultPrevented` 阻止 |
| `changeAction` | `(value, e) => void | Promise<void>` | — | 异步变更动作：pending 期间自动 spinner + `aria-busy` |
| `type` | `"text" \| "password" \| "email" \| "url" \| "tel" \| "search" \| "number"` | `"text"` | HTML input type（透传原生 `<input type>`） |
| `placeholder` | `string` | — | 占位文本 |
| `htmlName` | `string` | — | 原生 `name`（表单提交；禁用时不提交） |
| `startIcon` | `JSX.Element` | — | 前置图标（如 `<Icon icon="mdi:magnify" />`） |
| `hasClear` | `boolean` | `false` | 有值时显示 ✕ 清除按钮：清空并回焦输入框 |

### 标签与校验

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `label` | `string` | — | 可访问标签（组件始终渲染） |
| `isLabelHidden` | `boolean` | `false` | 视觉隐藏标签（屏幕阅读器仍可读） |
| `description` | `string` | — | 标签与输入框之间的描述文本 |
| `isRequired` | `boolean` | `false` | 必填：label 后危险色 `*` + `aria-required`（与 `isOptional` 互斥） |
| `isOptional` | `boolean` | `false` | 选填：label 旁 `t("field.optional")` 标记 |
| `labelTooltip` | `string` | — | 标签行尾部信息图标 tooltip（悬停/聚焦显示） |
| `status` | `{ type, message? }` | — | 校验状态（见下表）；`type: "error"` 时自动 `aria-invalid` |
| `statusVariant` | `"attached" | "detached" | "tooltip"` | `"attached"` | 状态消息排布 |

### 行为

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `size` | `"sm" | "md" | "lg"` | `"md"` | 尺寸档位（与 Button 对齐：24/32/40px 高，对应 `sizeSm/Md/Lg`） |
| `isDisabled` | `boolean` | `false` | 禁用（整体 opacity 0.55 + not-allowed；边框/文字再单独减淡至 ~60%，占位符 ~40%） |
| `isReadOnly` | `boolean` | `false` | 只读：不置灰、仍在 tab 序、随表单提交，但不可编辑 |
| `disabledMessage` | `string` | — | 禁用原因：与 `isDisabled` 同设时改用 `aria-disabled` + `readOnly`，悬停/聚焦在输入框上方显示说明 tooltip（键盘可达） |
| `isLoading` | `boolean` | `false` | 显式加载态（spinner + `aria-busy`） |
| `onEnter` | `() => void` | — | Enter 键回调 |
| `onKeyDown` | `(e) => void` | — | 键盘事件（Enter 先触发 `onEnter`） |
| `onInput` | `(e) => void` | — | 原生 input 事件（先于 `onChange`） |
| `hasAutoFocus` | `boolean` | `false` | 挂载时自动聚焦 |
| `width` | `number | string` | — | 整个字段宽度（label/控件/状态消息一起对齐）：数字=px，字符串原样（如 `"100%"`） |
| `colorVars` | `TextInputColorVars` | — | 颜色变量覆盖（作用于字段根元素），见「视觉规格」；默认值取自 theme.stylex tokens |
| `ref` | `(el: HTMLInputElement) => void` | — | 输入框 DOM 引用 |

### 样式注入（三条通道，作用于输入容器）

| Prop | 说明 | 优先级 |
|---|---|---|
| `style` | 内联样式 | 最高（内联） |
| `xstyle` | StyleX 样式（`stylex.create` 产物），进入 `stylex.props` 末尾，**同名属性覆盖内部** | 覆盖内部 |
| `class` / `className` | 外部 CSS 类，与内部 stylex 类名**拼接共存**（不覆盖） | 层叠取决于样式表顺序 |

> 颜色配置请走 `colorVars`（作用于整个字段根元素）——`style`/`xstyle`/class 作用在输入容器上，无法把变量传给 label/状态消息等兄弟元素。

其余原生属性（`aria-*`、`data-*`、`pattern`、`maxLength`、`minLength` 等）直接透传给 `<input>`。

## 尺寸

| size | 高度 | 字号 | 左右内边距 |
|---|---|---|---|
| `sm` | 24px（`sizeSm`） | 12px（`fontSizeXs`） | 6px（高度 × 0.25） |
| `md` | 36px（`sizeMd` + `spacing1`） | 16px（`fontSizeMd`） | 9px（高度 × 0.25） |
| `lg` | 48px（`sizeLg` + `spacing2`） | 16px（`fontSizeMd`） | 12px（高度 × 0.25） |

> 高度档位与 [Button](button.md) **完全对齐**（档位高度 + 档位附加 / 字号 / 圆角 `radiusMd` 同款）；左右内边距 = 整体高度 × 0.25（比按钮的 0.5 更紧凑）。聚焦（focus-within）时容器底色切换为 `--ti-focus-bg`。

## 校验状态

| `status.type` | 边框 / 图标 | 消息框 |
|---|---|---|
| `error` | `colors.danger` | `dangerWeak` 底 + `onDangerWeak` 字（阻止提交） |
| `warning` | `colors.warning` | `warningWeak` 底 + `onWarningWeak` 字（允许提交） |
| `success` | `colors.success` | `successWeak` 底 + `onSuccessWeak` 字（校验通过） |

`statusVariant`：
- `attached`：消息框紧贴输入框下方（带底色边框）
- `detached`：消息框独立下沉（加大间距）
- `tooltip`：不渲染消息框；状态图标变为可聚焦信息按钮，悬停/聚焦显示 tooltip

## 使用示例

```tsx
import { createSignal } from "solid-js";
import { TextInput, Icon } from "@dailogues/ui";

// 基础受控（Astryx 官方示例形态）
const [name, setName] = createSignal("");
<TextInput label="Name" value={name()} onChange={setName} placeholder="Enter your name" />

// 密码框 + 必填
const [pwd, setPwd] = createSignal("");
<TextInput label="密码" type="password" value={pwd()} onChange={setPwd} isRequired />

// URL / 电话 / 搜索：type 支持 url / tel / search / number 等原生单行类型
const [site, setSite] = createSignal("");
const [phone, setPhone] = createSignal("");
<TextInput label="官网" type="url" value={site()} onChange={setSite} placeholder="https://" />
<TextInput label="电话" type="tel" value={phone()} onChange={setPhone} />

// 选填 + 描述 + 信息图标
<TextInput label="备注" value={note()} onChange={setNote} isOptional description="最多 200 字" labelTooltip="选填，用于内部归档" />

// 校验状态（error 自动 aria-invalid；消息框 attached）
<TextInput label="邮箱" value={email()} onChange={setEmail} isRequired
  status={emailError() ? { type: "error", message: "邮箱格式不正确" } : undefined} />

// 状态消息独立下沉
<TextInput label="邀请码" value={code()} onChange={setCode}
  status={{ type: "warning", message: "该邀请码 24 小时后过期" }} statusVariant="detached" />

// 清除按钮（有值即显示 ✕，点击清空并回焦）
<TextInput label="搜索" value={query()} onChange={setQuery} hasClear startIcon={<Icon icon="mdi:magnify" width={16} height={16} />} />

// 异步校验动作：pending 期间自动 spinner + aria-busy
<TextInput label="用户名" value={user()} onChange={setUser}
  changeAction={async (v) => { await checkAvailable(v); }} />

// 显式加载态
<TextInput label="别名" value={alias()} onChange={setAlias} isLoading />

// 禁用（无原因） / 禁用 + 原因 tooltip（键盘可达）
<TextInput label="归属人" value={owner} isDisabled />
<TextInput label="归属人" value={owner} isDisabled disabledMessage="需要编辑角色才能修改" />

// 只读（不置灰、随表单提交）
<TextInput label="只读字段" value={fixedValue} isReadOnly htmlName="fixed" />

// Enter 提交
<TextInput label="命令" value={cmd()} onChange={setCmd} onEnter={() => run(cmd())} />

// 尺寸 + 整行撑满 / 固定宽度
<TextInput label="小" value={a()} onChange={setA} size="sm" />
<TextInput label="大" value={b()} onChange={setB} size="lg" />
<TextInput label="整行" value={c()} onChange={setC} width="100%" />

// 样式注入：xstyle 覆盖（同名属性生效）
import * as stylex from "@stylexjs/stylex";
const pageStyles = stylex.create({ wide: { maxWidth: "480px" } });
<TextInput label="邮箱" value={mail()} onChange={setMail} xstyle={pageStyles.wide} />
```

## 无障碍行为

- **可访问名**：`label` 始终渲染（`isLabelHidden` 时视觉隐藏），经 `aria-labelledby` 关联输入框
- **描述与状态**：`description`、状态消息（非 tooltip 变体）、禁用原因 tooltip 全部接入 `aria-describedby`
- **必填 / 无效**：`aria-required`、`status.type === "error"` 时 `aria-invalid="true"`
- **加载**：`aria-busy` + spinner；`changeAction` pending 期间自动置位
- **禁用语义**：普通禁用用原生 `disabled`；带 `disabledMessage` 时用 `aria-disabled` + `readOnly`（保持键盘可聚焦以触达原因）
- **焦点**：容器 `:focus-within` 边框转 `onSurface` + 柔和光环；清除/状态/信息按钮 `:focus-visible` 2px 描边
- **键盘**：Enter 触发 `onEnter`；点击容器空白处聚焦输入框
- **动效**：过渡动画尊重 `prefers-reduced-motion`

## 已知限制

1. **StyleX 0.19 不支持 `border` shorthand**（`property-specificity` 模式静默丢弃、不报错）。外部 `xstyle` 中写边框请用 `borderWidth` + `borderStyle` + `borderColor` 三个 longhand。
2. **受控组件**：`value` 变化依赖父级更新（与 Astryx 一致）；`hasClear` 点击后若父级未同步清空值，✕ 不会消失。
3. **图标网络加载**：`startIcon` / 状态图标 / 清除 ✕ 经 `Icon` 按需从 iconify API 拉取（模块级缓存）；离线时显示占位空白。可用 `addIcon` 注册本地图标避免网络依赖。
4. **tooltip 定位**：tooltip 使用统一组件 `Tooltip`（tooltip.tsx），绝对定位于锚点（信息图标 / 状态按钮 / 输入容器）正上方，若祖先容器 `overflow: hidden` 且贴边，气泡可能被裁剪。
5. **statusVariant="tooltip"** 时状态图标为可聚焦按钮，已接入 `aria-describedby`，但无消息时不显示 tooltip。
