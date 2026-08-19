# Carousel 轮播

两站共享的横向滚动容器（studio 工作台 + site 消费端）。复刻自 [Astryx Carousel](https://astryx.atmeta.com/components/Carousel)（Meta 开源设计系统，MIT），接口与行为对齐其参考实现（[github.com/facebook/astryx](https://github.com/facebook/astryx)）；技术栈为 **Solid + StyleX**，视觉变量全部引用 `theme.stylex` 非废弃 tokens（`colors` / `dimensions` / `durations` / `easings` / `shadows`）。

- 源文件：`packages/ui/src/components/carousel.tsx`
- 依赖：`solid-js ^1.9`、`@stylexjs/stylex ^0.19`、`@dailogues/i18n`（复用 `./button`、`./icon`，无新增依赖）

## 设计思想

Carousel 不是「翻页幻灯片」，而是**原生横向滚动容器**（`overflow-x: auto`）：

- 触摸设备按住拖动、触控板横扫、鼠标 `Shift + 滚轮` 均为浏览器原生行为，平滑且不拦截页面纵向滚动
- 溢出时边缘浮现渐变遮罩（`mask-image`，指示还有更多内容）+ 两侧圆形翻页按钮
- 内容不溢出时遮罩与按钮自动隐藏，组件退化为普通一行

## Props 接口

| Prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `children` | `JSX.Element` | — | 轮播项（必填）。每项会被包一层 flex item（`flexShrink: 0` + `scroll-snap-align: start`）；**宽度由内容决定，消费方需给子项定宽**（如 `style={{ width: 200 }}` 或外层定宽 div） |
| `gap` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4` | `1` | 项间距（spacing 档位：1 = 4px，2 = 8px，3 = 12px…；0.5/1.5 = 2px/6px） |
| `hasButtons` | `boolean` | `true` | 内容可滚动时显示上/下一页按钮（圆形胶囊，垂直居中跨骑左右边缘；不可滚动方向隐藏 + 禁用） |
| `hasEdgeFade` | `boolean` | `true` | 溢出时显示边缘渐变遮罩（可关闭——子项带完整表面时遮罩会「压暗」内容） |
| `hasLoop` | `boolean` | `false` | 循环滚动：内容溢出时末尾 Next 回到起点、起点 Prev 跳到末尾；按钮两端常驻而非隐藏。内容不溢出时无效果 |
| `hasSnap` | `boolean` | `false` | 滚动吸附：容器 `scroll-snap-type: x mandatory`，每项吸附到起始边缘（适合相册/商品列表等需精确对齐的场景） |
| `padding` | `0 \| 0.5 \| 1 \| 1.5 \| 2 \| 3 \| 4 \| 5 \| 6 \| 8 \| 10` | — | 滚动容器内边距（`padding-inline` + 匹配的 `scroll-padding`，吸附点对齐内容边缘而非视口边缘） |
| `aria-label` | `string` | `t("carousel.label")` | 轮播区域的可访问名称（APG：根为 `region` + `aria-roledescription="carousel"`） |
| `ref` | `(el: HTMLDivElement) => void` | — | 根元素引用（Solid 回调） |
| `handleRef` | `CarouselHandleRef` | — | 命令式句柄（见下） |
| `xstyle` | `StyleXStyles` | — | StyleX 样式（`stylex.create` 产物），与内部样式合并、冲突时覆盖 |
| `itemXstyle` | `StyleXStyles` | — | 每项包裹层的 StyleX 样式。**「每屏 N 条恰好贴边」用百分比宽**：`width: calc(100%/N - (N-1)×gap/N)`——百分比相对滚动容器实际宽度解析（精确跟随容器，不受滚动条宽度 / box-sizing / max-width 影响）。子项自身用 `width: 100%` 撑满包裹层 |
| `className` / `class` | `string` | — | 外部 CSS 类，与内部 stylex 类名拼接共存 |
| `style` | `CSSProperties` | — | 根元素内联样式（页面级微调） |
| `data-testid` | `string` | — | 测试选择器 |

其余原生属性（`id`、`aria-*`、`on*` 事件等）透传给根元素。

## CarouselHandle（handleRef）

命令式控制句柄，方法驱动与内置按钮相同的原生滚动机制（尊重 `hasLoop`、`prefers-reduced-motion` 与 RTL）。

```ts
export interface CarouselHandle {
  /** 向前滚动约一个视口；hasLoop 时到达末尾回到起点 */
  scrollNext(): void;
  /** 向后滚动约一个视口；hasLoop 时到达起点跳到末尾 */
  scrollPrev(): void;
  /** 把第 index（0 起）项滚到起始边缘；index 越界自动夹紧，只滚动自身不动页面 */
  scrollTo(index: number): void;
  /** 末尾方向是否还有可滚动内容；hasLoop 时只要有溢出恒为 true（实时读取，可在事件处理器中调用） */
  canScrollNext(): boolean;
  /** 起始方向是否还有可滚动内容；hasLoop 时只要有溢出恒为 true */
  canScrollPrev(): boolean;
}
```

Solid 中传**回调**或 **{ current } 对象**（React Ref 对象兼容形态）均可；组件卸载时回调收到 `null`、对象的 `current` 置 `null`：

```tsx
let carousel!: CarouselHandle;
<Carousel handleRef={(h) => (carousel = h!)} />

// 或
const refObj = { current: null as CarouselHandle | null };
<Carousel handleRef={refObj} />

// 使用
<Button onClick={() => carousel.scrollNext()} />
<Button onClick={() => carousel.scrollTo(4)} disabled={!carousel.canScrollNext()} />
```

## 使用示例

```tsx
// 基础：一行横向滚动（内容不溢出时无按钮/遮罩）
<Carousel gap={2} aria-label="推荐节目">
  <Card style={{ width: 220 }}>…</Card>
  <Card style={{ width: 220 }}>…</Card>
</Carousel>

// 响应式定宽：视口窄时 2 张/屏，宽时 4 张/屏——百分比相对滚动容器实际宽度解析，
// 恰好贴边（gap={3}=12px：2 张扣 1 个间距 → -6px；4 张扣 3 个间距 → -9px）
const DESKTOP = "@media (width >= 1024px)";
const TABLET = "@media (640px <= width < 1024px)";
const styles = stylex.create({
  item: {
    width: "calc(50% - 6px)",
    [TABLET]: { width: "calc(25% - 9px)" },
    [DESKTOP]: { width: "calc(25% - 9px)" },
  },
});
<Carousel gap={3} itemXstyle={styles.item} aria-label="推荐节目">
  <For each={items}>{(it) => <EpisodeCard … style={{ width: "100%" }} />}</For>
</Carousel>

// 相册/商品：吸附 + 循环
<Carousel hasSnap hasLoop gap={1}>
  <Thumb src="/a.jpg" style={{ width: 160 }} />
  <Thumb src="/b.jpg" style={{ width: 160 }} />
</Carousel>

// 禁用按钮/遮罩（纯原生横滑）
<Carousel hasButtons={false} hasEdgeFade={false} />

// 内容内边距（吸附点对齐内容边缘）
<Carousel padding={2} hasSnap>
  …
</Carousel>
```

> 定宽公式说明：百分比（`100%/N`）相对滚动容器**实际渲染宽度**解析——自动跟随容器（含滚动条、box-sizing、max-width 等全部因素），比任何基于 `100vw` 的反推公式都精确。`- 6px`/`- 9px` 为扣除的项间距（gap 12px：2 张时 1 个间距 / 4 张时 3 个间距）。换 gap 时按 `(N-1)×gap/N` 重算。

## 无障碍行为

- **区域语义**（APG carousel 模式）：根 `role="region"` + `aria-roledescription="carousel"` + `aria-label`（默认 `t("carousel.label")`）
- **滑片语义**：每项 `role="group"` + `aria-roledescription="slide"` + 名称「第 N 张，共 M 张」（`carousel.slideLabel`），AT 可播报轮播边界与位置
- **键盘**：滚动容器 `tabIndex={0}` 可聚焦，聚焦后 `←`/`→` 键原生滚动；`:focus-visible` 2px primary 描边
- **按钮**：不可滚动方向隐藏（opacity 0 + `pointer-events: none`）且原生 `disabled`（移出 Tab 序与 a11y 树）
- **动效**：`scroll-behavior: smooth`、按钮翻页与遮罩过渡均尊重 `prefers-reduced-motion`（自动切 `auto`/即时）
- **鼠标**：`Shift + 滚轮` 映射为横向滚动（仅纯纵向滚轮 + 有溢出时拦截，触控板横向不受影响）

## 已知限制

1. **无 Layer 系统**：Astryx 原版把翻页按钮渲染到顶层（Layer）以逃出祖先 `overflow` 裁剪；本站实现为根内绝对定位浮层（根不设 `overflow: clip`）。若 Carousel 的祖先有 `overflow: hidden` 且紧贴边缘，跨骑的按钮可能被裁剪。
2. **子项需定宽**：item wrapper 是 `flex-shrink: 0` 的 flex item，宽度由内容决定；不给子项定宽会导致各项宽度不一致（随内容收缩）。需要「每屏 N 条贴边」时用 `itemXstyle` 给包裹层定百分比宽（见 Props 表）。
3. **滚动条**：`scrollbar-width: none` 隐藏（与站点 playlistRail 一致）；老版本 Safari 可能仍显示滚动条。
4. **RTL**：滚动方向/溢出判断按 `direction: rtl` 做了符号翻转，但按钮图标未做镜像；项目当前为 LTR，未完整验证 RTL。
5. **`hasSnap` 使用 `mandatory`**：吸附较强，连续快速滚动会被吸附打断——需要「滑多少看多少」的连续浏览场景请勿开启。
