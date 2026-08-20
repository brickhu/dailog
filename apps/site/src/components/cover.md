# Cover 封面组件

> 位置：`apps/site/src/components/cover.tsx`

统一封面组件：**只负责显示图片，无交互、无按钮**。播放按钮（PlayButton，独立组件 `play-button.tsx`）由调用方叠加在封面之上（grid 卡片 hover 划入 / list 右侧 / 详情页按钮区）。

## Props

| prop | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `episode` | `QueueEpisode` | 必填 | 节目 meta（id / coverUrl / title），封面 URL 由此派生 |
| `sizes` | `string` | `DETAIL_COVER_SIZES` | 响应式选图（`<img sizes>`）；卡片场景传 `CARD_COVER_SIZES` 或固定值如 `"400px"` |
| `xstyle` | `stylex.StyleXStyles` | — | **外部 StyleX 样式**（stylex.create 产物），与内部 wrap 在同一个 `props()` 调用中合并（外部在后，冲突属性外部胜出） |
| `style` | `JSX.CSSProperties` | — | 内联样式透传到根 div（优先级最高，覆盖所有类）；用于动态内联值 |
| `class` | `string` | — | 原生 class 透传（追加到根 div；与 stylex 类共存） |

> 样式接口命名与 ui 包（Center / Grid / Button 等 11 个组件）统一为 **`xstyle`**。

## 尺寸控制

### 默认行为

根容器 `wrap` 自带：

- `width: 100%` —— 宽度跟随父容器
- `aspectRatio: 1 / 1` —— 高度按宽等比（正方形）
- `flexShrink: 0`

不传任何尺寸 prop 时，封面铺满父容器宽度并保持正方形。

### 外部控制尺寸（推荐：`xstyle`）

```tsx
const styles = stylex.create({
  cover: { width: "50%" },
  coverMobile: { [TABLET]: { width: "30%" } },
});
<Cover episode={e} xstyle={styles.cover} />
```

传入 **`stylex.create` 出来的原始样式对象**（不是 `stylex.props(...)` 的结果）。组件内部是

```tsx
<div {...stylex.props(styles.wrap, props.xstyle)} style={props.style} class={props.class}>
```

同一个 `props()` 调用中，styleq 运行时合并去重——外部与内部冲突的属性（width / aspectRatio / …）**确定性**由外部胜出。

### ⚠️ 不要把 `stylex.props(...)` 的结果 spread 进组件

```tsx
// ❌ 坏：外部原子类只拼接进 class 字符串，与内部 wrap 的类冲突时靠 CSS 级联，不可控
<Cover episode={e} {...stylex.props(styles.cover)} />
```

跨组件边界 spread 时，两次独立的 `props()` 调用不会合并去重，同名属性谁生效取决于编译产物 CSS 中的类顺序。**自定义组件一律用 `xstyle` prop；`{...stylex.props(x)}` 只用于原生元素 / `<A>`**。

### 高度控制注意

wrap 自带 `aspectRatio: 1 / 1`，外部只设 `width` 时高度仍按比例推导。要同时控制高度需一并覆盖 aspectRatio：

```tsx
const cover = stylex.create({
  wide: { width: "200px", aspectRatio: "16 / 9" },
});
```

## 渲染层级

```
┌─ 根容器 div（wrap + 外部 xstyle 合并，relative，overflow hidden）
│  ├─ LQIP 底图 img（160w 小图，blur(24px) + scale(1.15)，装饰层 aria-hidden）
│  ├─ 大图 img（srcset/sizes 响应式，opacity 0 → 就绪后 0.35s 淡入）
│  └─ 错误占位 div（大图加载失败时覆盖，BrandPattern 品牌图案）
└─（无封面 URL 时：直接渲染 placeholder，BrandPattern 居中）
```

## 图片管线

- **URL 派生**：`episodeCoverUrl(id, coverUrl, width?)` / `episodeCoverSrcset(id, coverUrl)`（见 `../lib/env`）
- **LQIP**：最小档 `?w=160` 高斯模糊铺底，首帧不空白、慢网有预览；`scale(1.15)` 防模糊边缘露出背景色
- **大图**：`src` 兜底 `?w=960`，srcset 多档 + `sizes` 选图；就绪后淡入变清晰
- **就绪判定**：不依赖 onLoad 事件（hydration 时序下图片可能先于事件绑定完成加载，onLoad 丢失会卡在模糊态）——onMount 用 `img.complete && naturalWidth > 0` 同步检查（缓存/已加载直接清晰），未加载靠 onLoad 事件补
- **加载失败**：`onError` 置 `imgError`，BrandPattern 占位覆盖

## 样式细节

- **无圆角**；**inset 描边**（`boxShadow: inset 0 0 0 1px color-mix(currentColor 20%)`）画在盒子内不占布局，`currentColor` 跟随页面前景色（浅/暗主题自动适配）
- 背景 `colors.surface`，占位背景 `colors.surfaceStrong`

## 代码内用法

| 位置 | 场景 | 尺寸方式 |
| --- | --- | --- |
| `components/episode-card.tsx` compact | 精简封面 | `xstyle={props.xstyle}`（透传 EpisodeCard 的 xstyle） |
| `components/episode-card.tsx` list | 列表封面 | `xstyle={styles.coverList}`（56×56，stylex.create 定义） |
| `components/episode-card.tsx` grid | 网格卡片封面 | 父级 `coverSlot` 控制，不传 |
| `routes/episode/[slug].tsx` | 详情页封面 | `xstyle={styles.cover}`（如 `width: 50%`）+ `sizes="400px"` |
