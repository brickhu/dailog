# 开发指南（避坑手册）

> 记录开发过程中踩过的坑与解决方案。**新会话 / 新 Agent 接手前先读本文件**，
> 避免重复排查。每个坑都标注了根因、修复与"勿回退"注意事项。
> 最后更新：2026-08-14

## 1. StyleX dev 模式 FOUC —— 首帧无样式闪烁（已修复，勿回退）

### 现象
dev 环境（dailog.orb.local，vinxi dev）下每次加载页面，先出现无样式的 DOM 结构，
"晃一下"才渲染为有样式效果。

### 根因（两层问题叠加，dev 与生产**同样存在**）
1. **CSS 链接是死链（仅 dev）**：`@stylexjs/unplugin` 0.19 通过 transformIndexHtml 注入
   `<link rel="stylesheet" href="/_build/virtual:stylex.css">`（带 vinxi base 前缀 `/_build`），
   但它自己的 dev 中间件只匹配**无前缀**的 `/virtual:stylex.css`
   （`lib/consts.js` 的 `DEV_CSS_PATH`）→ 请求永远命中不了中间件，
   落到 vinxi 的 SPA fallback（返回 HTML 页面）→ 浏览器加载"CSS"失败、
   不阻塞渲染 → 首帧只有 stylex 类名、没有样式规则。
2. **样式收集为空（dev + 生产都中招）**：`runtimeInjection: true`（默认）时样式被编译成
   JS 注入调用（每个模块运行时 `stylex.inject`），CSS 收集（`__stylexCollectCss`）为空：
   - dev：中间件返回 **0 字节**，样式只能等 `virtual:stylex:runtime` 脚本注入 → 闪烁；
   - **生产**：构建产物 CSS 只剩 app.css reset（约 1.2KB，stylex 规则 0 条）——SSR HTML
     的 `<link rel="stylesheet" href="/_build/assets/client-*.css">` 引用的是这份空壳 CSS
     → 首帧无组件样式，等客户端 JS 逐条注入样式 → 同样 FOUC。

### 修复（`apps/site/app.config.ts`）
- `stylex.vite({ dev: true, runtimeInjection: false, treeshakeCompensation: false })`
  —— 样式提取为 CSS 文本，dev 中间件可正常服务（约 40KB）。
- 新增 `fixStylexCssLink` 插件（仅 dev，`NODE_ENV=production` 跳过）：
  用 transformIndexHtml 的 **array 注入形式**在 `<head>` 补
  `<link rel="stylesheet" href="/virtual:stylex.css">`（无前缀，命中中间件）→
  浏览器 render-blocking → **首帧即有样式**。unplugin 注入的死链由其
  runtime 脚本自动禁用（`disableLink` 匹配含 `/virtual:stylex.css` 的 href）。
- 注意：vinxi 对 SSR HTML 调用 transformIndexHtml 时传入的是**空壳 HTML**（len≈1），
  string 返回形式无效，必须用 array 注入形式；`ctx.server` 也不可靠，用 NODE_ENV 判断。

### 验证方法
```bash
# dev：中间件应返回完整 CSS（约 40KB，此前 0 字节）
curl -s http://dailog.orb.local/virtual:stylex.css | wc -c
# 生产构建产物：client-*.css 应含 stylex 规则（约 48KB；runtimeInjection:true 时仅 1.2KB）
pnpm --filter @dailogues/site build && wc -c apps/site/dist/_build/assets/client-*.css
```

### 勿回退
- `runtimeInjection` 改回 `true` → dev 中间件返回 0 字节、**生产 CSS 只剩 1.2KB**，FOUC 复发。
- 删除 `fixStylexCssLink` 插件 → dev 的 link 又变死链。
- **修复后必须重新部署生产**（`wrangler pages deploy`）：旧部署的 CSS 产物是空壳，
  重新构建部署后 CSS 才含完整样式。

## 2. 路由导航 transition 无反馈 —— useIsRouting 方案（全站点击 loading 过渡）

### 现象
点击链接后 URL 已变化，但页面保持旧内容、没有任何 loading 反馈，
等 chunk/数据加载完才"突然"跳到新页面 —— 体验像"点了没反应"。

### 根因
@solidjs/router 1.x 的导航用 Solid 的 `transition` **延迟提交**：URL 立即变，
但 UI 保持旧值，直到目标路由 chunk + 数据（createAsync/server fn RPC）全部就绪
才一次性切换。等待期没有 Suspense 参与 → 全局 `<Suspense fallback>` 覆盖不到。

### 修复（`apps/site/src/app.tsx`）
用 router 官方提供的 `useIsRouting()`（导航 transition 进行中 = true）驱动 loading：

```tsx
function RouterOutlet(props: { children: JSX.Element }) {
  const isRouting = useIsRouting();
  return (
    <Show when={isRouting()} fallback={<Suspense fallback={<RouteLoading />}>{props.children}</Suspense>}>
      <RouteLoading />
    </Show>
  );
}
```
- `isRouting=true`（点击后立即）→ 内容区显示通用 Spinner（RouteLoading）
- transition 提交后 → 交给 Suspense（createAsync 若仍挂起则继续 spinner）→ 全程有过渡
- 导航栏/播放条在出口外，不中断

### 注意事项
- `useIsRouting` 必须在 Router 上下文内使用（Router root 里可以）。
- SSR 首帧 `isRouting=false`，不影响首屏。
- hover 预取（A 组件默认 hover preload + 首页卡片 onPointerEnter）后导航
  transition 极快，spinner 一闪或几乎不出现 —— 符合"立即"预期。

## 3. CSS Grid `1fr` 轨道的 min-content 陷阱（卡片被裁）

### 现象
首页推荐滚屏每屏 4 张卡片，桌面第 4 张 / 移动端第 2 列被裁掉一部分。

### 根因
`grid-template-columns: repeat(4, 1fr)` 的 `1fr` 轨道有 **min-content 下限**：
卡片标题 `whiteSpace: nowrap`（省略号截断）使卡片最小宽度 ≈ 315px，
4 列被撑到 ~1260px，超出容器宽度（1016px）→ 容器 `overflow: hidden` 裁掉右侧。

### 修复
```css
grid-template-columns: repeat(4, minmax(0, 1fr));   /* 移动端同理 repeat(2, minmax(0, 1fr)) */
```
轨道真正等分，长标题走省略号。这是 grid 布局的通用坑，任何"等分 + 不换行文本"场景都适用。

## 4. `overflow: hidden` 的裁剪边界是 padding 外缘（相邻分页冒头）

### 现象
滚屏展示中，第 2 屏的第 1 张卡片会从右侧露出一条（"第 5 期冒头"）。

### 根因
`overflow: hidden` 裁剪的是 **padding box**（含内边距区域），不是内容盒：
视口带左右 padding 时，轨道从内容区开始，相邻分页从内容区右缘开始 ——
其前 32px 正好落在视口的 padding 区域内、裁剪边界之内 → 露出来。

### 修复
左右内边距移到**每个分页（pagePane）内部**，视口自身无左右 padding →
裁剪边界 = 容器边缘 = 分页边缘，相邻分页整体在裁剪边界之外。
