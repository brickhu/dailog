# Dialog 弹窗

两站共享的模态弹窗（studio 工作台 + site 消费端）。复刻自 [Astryx Dialog](https://astryx.atmeta.com/components/Dialog)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` 非废弃 tokens（`colors` / `dimensions` / `durations` / `easings` / `shadows`）。

- 源文件：`packages/ui/src/components/dialog.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`（无新增依赖）
- 遮罩色：`theme.stylex` 暂无 overlay token，组件内内联定义（浅色 50% / 深色 65% 黑 + blur(2px)）

```tsx
import { Dialog, useDialogContext } from "@dailogues/ui";
```

## 基本用法

```tsx
function Example() {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>打开</Button>
      <Dialog isOpen={open()} onOpenChange={setOpen}>
        <h2 id={useDialogContext()?.titleId}>标题</h2>
        <p>内容</p>
        <Button onClick={() => setOpen(false)}>关闭</Button>
      </Dialog>
    </>
  );
}
```

`onOpenChange(false)` 在用户按 Escape / 点遮罩时触发（**受控**：是否真正关闭由消费方决定）。标题元素用 `useDialogContext().titleId` 作为 id 时，Dialog 会自动回写 `aria-labelledby`；也可直接传 `aria-label`（优先且不被改动）。

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `isOpen` | `boolean` | 必填 | 是否打开（受控） |
| `onOpenChange` | `(open: boolean) => unknown` | 必填 | 用户请求关闭（Escape/点遮罩）时回调 |
| `children` | `JSX.Element` | 必填 | 弹窗内容 |
| `variant` | `"standard" \| "fullscreen"` | `"standard"` | fullscreen 铺满视口（忽略 width/position/padding 尺寸约束） |
| `purpose` | `"info" \| "form" \| "required"` | `"info"` | `info`=Escape+点遮罩；`form`=仅 Escape；`required`=全部禁用 + `role="alertdialog"` |
| `width` | `number \| string` | `400` | 数字=px，字符串原样；fullscreen 忽略 |
| `maxHeight` | `number \| string` | `"75vh"` | 同上 |
| `position` | `{ top?, bottom?, start?, end? }` | 居中 | 逻辑方向偏移（RTL 镜像），数字=px |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | `4` | 内边距档位（对应 spacingN；0.5/1.5 为 2px/6px） |
| `isInline` | `boolean` | `false` | 纯展示模式：无 `<dialog>`/模态行为（文档预览用），未打开时返回 null |
| `xstyle` | `StyleXStyles` | — | 外部 StyleX 样式，最后合并、冲突时覆盖 |
| `ref` | `(el: HTMLDialogElement) => void` | — | 根元素引用 |
| `class` / `className` | `string` | — | 与内部 stylex 类名拼接 |
| 其余 | 原生 `<dialog>` 属性 | — | 透传（`open` 除外，内部管理） |

## 行为契约

- 基于原生 `<dialog>` + `showModal()`：浏览器自带模态层、焦点圈定与 `::backdrop`；打开前记录触发元素（进入动画起点 + 关闭后焦点恢复），打开后聚焦第一个 `[data-autofocus]` 元素（挂载期 autofocus 会早于 showModal 静默失败）
- 进入动画从触发元素方向位移（`--dialog-dir-x/y`），尊重 `prefers-reduced-motion`
- Escape 双保险（keydown + onCancel）：过滤 IME 输入法取消键（`isComposing` / keyCode 229）、`preventDefault` 后交还 `onOpenChange(false)`；required 时阻断原生 cancel
- 分层弹层：模块级注册表 `pushEscapeLayer` / `isTopEscapeLayer`（从 `@dailogues/ui` 导出），单次 Escape 只关最上层——未来 popover/menu 打开时 push 自己的 handler 并在其 Escape 处理中 `stopPropagation` + `preventDefault` 即可接入
- 点遮罩只认 `event.target === currentTarget`（避免原生弹层 date picker 等误判）
- 滚动锁（body overflow hidden）带嵌套计数，多弹层叠加时正确还原
- 打开的模态弹窗无可访问名称时 `console.warn` 一次（开发提示）
