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
用 router 官方提供的 `useIsRouting()`（导航 transition 进行中 = true）驱动：
**点击后立即渲染全局骨架屏**（结构化 shimmer：标题条/段落条/卡片网格），不在原页面停留；
transition 提交后真实页面接管（数据已就绪），createAsync 若仍挂起则由 Suspense
fallback 继续显示骨架 —— 全程"骨架屏 + 局部懒加载"。

```tsx
function RouterOutlet(props: { children: JSX.Element }) {
  const isRouting = useIsRouting();
  return (
    <Show when={isRouting()} fallback={<Suspense fallback={<RouteSkeleton />}>{props.children}</Suspense>}>
      <RouteSkeleton />
    </Show>
  );
}
```
- 骨架屏复用首页卡片的 shimmer 模式（`stylex.keyframes` 内联 + surface 灰块，自动适配暗色）
- 设计决策：**不能**用"旧内容 + 遮罩"或"内容区替换成 spinner 容器"——用户明确要求
  "点击立即进入目标页面、骨架屏过渡，不在原页面停留"。

### 注意事项
- `useIsRouting` 必须在 Router 上下文内使用（Router root 里可以）。
- SSR 首帧 `isRouting=false`，不影响首屏。
- hover 预取（A 组件默认 hover preload + 首页卡片 onPointerEnter）后导航
  transition 极快，骨架一闪或几乎不出现 —— 符合"立即"预期。
- 不要用全局 spinner/遮罩方案替换骨架屏：路由切换体验以骨架屏为准。

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

## 4. 应用壳布局（fixed 100vw×100vh）—— 页面滚动在内容区

### 结构（`apps/site/src/app.tsx` AppShell + app.css）
- `html, body { overflow: hidden }` —— **页面级滚动禁用**
- 壳容器 `position: fixed; width: 100vw; height: 100vh; display: flex; column`：
  顶部导航（固定）→ 内容区（`flex: 1; min-height: 0; overflow-y: auto`）→ 播放条（fixed bottom）
- 路由出口（RouterOutlet/骨架屏）与 Footer 都在内容区内

### 影响与注意
- **滚动发生在内容区**，不在 window：路由切换回顶用 `contentRef.scrollTop = 0`
  （AppShell 里 `createEffect` 监听 `location.pathname`）；不要在页面代码里依赖
  `window.scrollTo` / `window.scrollY`。
- 页面组件 `minHeight: 100vh` 语义不变（内容区高度 < 视口，页面仍充满一屏，
  超出部分在内容区滚动）。
- 骨架屏/加载态都在内容区内 → 切换页面无页面级跳动。
- 移动端注意：100vh 在 iOS 地址栏收起/展开时变化（如需可后续改 `dvh`）。

## 5. `overflow: hidden` 的裁剪边界是 padding 外缘（相邻分页冒头）

### 现象
滚屏展示中，第 2 屏的第 1 张卡片会从右侧露出一条（"第 5 期冒头"）。

### 根因
`overflow: hidden` 裁剪的是 **padding box**（含内边距区域），不是内容盒：
视口带左右 padding 时，轨道从内容区开始，相邻分页从内容区右缘开始 ——
其前 32px 正好落在视口的 padding 区域内、裁剪边界之内 → 露出来。

### 修复
左右内边距移到**每个分页（pagePane）内部**，视口自身无左右 padding →
裁剪边界 = 容器边缘 = 分页边缘，相邻分页整体在裁剪边界之外。

## 6. vite HMR websocket 端口与 TLS（dev 环境）

### 现象
https://dailog.orb.local 控制台刷屏：
`WebSocket connection to 'wss://dailog.orb.local:38123/_build/...' failed` + `[vite] failed to connect to websocket`。

### 根因
vinxi 0.5.11 对每个 router 的 vite server 用 `getRandomPort()` 分配 **HMR ws 端口**
（`lib/dev-server.js` createViteHandler）→ 随机端口（如 38123）无 TLS（OrbStack 只对 443
自动 TLS）→ https 页面 wss 连接失败。compose 注释里的旧教训（"3001 无 TLS"）同源。

### 修复
1. **pnpm patch vinxi**（`patches/vinxi@0.5.11.patch`，`pnpm.patchedDependencies` 固化）：
   HMR 端口支持 `VINXI_HMR_PORT` 环境变量覆盖，不再随机。
2. compose：`VINXI_HMR_PORT=24680` + publish `24680:24680`。

### 现状与访问指引
- **`http://dailog.orb.local`（推荐开发访问）**：HMR 完整工作（ws://24680，握手 101 已验证）
- **`https://dailog.orb.local`**：功能正常，但 wss 仍会报错（OrbStack 对非 443 publish 端口
  无 TLS，属平台限制）——改代码后手动刷新即可；需要安全上下文的功能（录音/登录）用 https。
- 换机器/重装依赖：`pnpm install` 自动应用 patch；compose 环境变量已配置。

## 7. /example 页（dev-only）Hydration Mismatch —— 结论修正记录

### 现象
访问 /example（UI 组件示例页）控制台报：
`Hydration Mismatch. Unable to find DOM nodes for hydration key: ... <span></span>`

### 2026-08-15 修正（前期结论作废）
前期多轮"二分定位"**结论不可信**：当时一直误改 `packages/ui/src/examples.tsx` 并认为它是
/example 页面 —— 实际路由渲染的是 `apps/site/src/routes/example.tsx`（`<Examples />`）。
且浏览器侧验证受 **IAB 缓存**污染（curl 已是新版、浏览器仍显示旧页，"无 mismatch"假象多次出现）。
**已修复项**（代码层面合理改进，非根因验证）：
- **Icon 组件**（`packages/ui/src/components/icon.tsx`）：恢复完整版 —— SSR 渲染空 span、
  客户端 hydration 结束后 `loadIcon` 从 iconify API 按需拉取内联 SVG 注入
  （`setTimeout 0` 延迟注入，避免嵌套组件 onMount 早于父级 hydration 完成）。
- **Banner 的 Dismiss/expand**（`banner.tsx`）：由 Button+Icon 嵌套改为原生 `<button>`
  （减少组件嵌套；contentId 恢复 `createUniqueId()`）。
- **/example 页**（`apps/site/src/routes/example.tsx`）：渲染 `@dailogues/ui` 的 `<Examples />`
  完整组件示例（7 个 Banner 变体 + Button 组 + 图标 Icon demo），SSR 已验证输出完整。

### 现状与建议
- /example 为 **dev-only**（生产构建不渲染），站点正常页面不使用 Icon 组件，无生产影响。
- 浏览器侧残余 mismatch 若复现，优先怀疑**浏览器缓存**（换新 tab + 无痕窗口验证），
  不要再用"浏览器目测"做二分判断；以 curl SSR + typecheck/build 为准。
- 图标在 example 页的显示依赖客户端注入（onMount），hydration 正常时注入即可显示。

## 8. @iconify/utils 的 loadIcon 不访问网络 —— 图标按需注入的正确姿势

### 现象
Icon 组件用 `loadIcon("mdi", "chevron-down")` 后，FAQ/CTA 的图标全部不显示。

### 根因
`@iconify/utils` 的 `loadIcon`（`lib/loader/loader.js`）**只处理两件事**：
1. `options.customCollections`（自定义图标数据）
2. `loadNodeIcon` 变体（`node-loader.js`）会从本地文件系统找 `@iconify-json/*` 包

**两者都不访问网络**。无 customCollections、无本地图标集时 `loadIcon` 恒返回
`undefined`（Node 实测确认），注入结果为 `""` → 图标空占位。它取名"loader"但实际
是"从本地图标数据解析"器，不是"网络按需加载"器。

### 修复（`packages/ui/src/components/icon.tsx`）
按需注入直接请求 iconify API 的 SVG 端点：
`https://api.iconify.design/{collection}/{name}.svg`（可选 `?height=` / `?width=`），
`r.text()` 即完整 `<svg>` 字符串，`innerHTML` 注入。
- 模块级 `Map<url, Promise<string>>` 缓存：同一图标只请求一次（FAQ 6 个相同 chevron 只发 1 个请求）；
  空串（失败）不缓存，允许重试。
- 不带尺寸参数时 SVG 以 `width="1em" height="1em"` 响应，继承外层 font-size；
  path 为 `fill="currentColor"`，颜色继承外层 color（Icon 的 style.color 可着色）。
- 保留 `setTimeout(0)` 延迟注入（hydration 安全，见 §7）。

## 9. 浏览器端直连 API 被 CORS 拦截 → 客户端导航后数据永远失败（骨架/白屏）

### 现象
点击链接跳转 hosts/guests 等页面后，骨架屏/空白**永久显示**，数据不出现；
首页统计、详情页计数同理。控制台：`Access to fetch at 'http://localhost:8787/...'
blocked by CORS policy: No 'Access-Control-Allow-Origin' header`。

### 根因（两层）
1. **CORS 白名单**：API 的 `APP_ORIGINS`（docker-compose）只含
   `https://dailog.orb.local` 等，**不含 `http://localhost:3000`** —— localhost 直连被拦截。
2. **fetch 基址**：`env.apiBaseForFetch` 在浏览器端返回
   `apiBaseUrlPublic ?? apiBaseUrl` = `http://localhost:8787`（dev）→ 跨域直连。
   SSR 端（node fetch 无 CORS）正常，所以首屏/直开没问题，只有**客户端导航**失败。
   对比 discover：数据走 lib/db（server-only + `cache()` 序列化，客户端导航 cache 命中）
   → 无浏览器 fetch → 无此问题。

### 修复（提交 60c4aa16）
- **浏览器端一律走同源代理**：`apiBaseForFetch` 浏览器端返回空串 →
  `${base}/v1/public/hosts` 变成同源相对路径 → 新增 site 代理路由
  `src/routes/v1/public/*`（hosts/guests/stats/episodes/recommended/episodes/[id]/stats）
  用 `proxyApi()` 转发 API（服务端 node fetch，无 CORS）。
- **CORS 白名单补 `http://localhost:3000`**（dev 直连双保险）。
- hosts/guests 数据区包**页面级 `<Suspense fallback={<ListSkeleton/>}>`**：
  资源挂起显示页面排版骨架（外层 RouterOutlet 的 CardGridSkeleton 只作兜底）。

### 注意事项
- 新增 site 端代理后，**所有**浏览器端 `/v1/*` 请求都走同源（与既有
  interactions/submissions 代理一致）；SSR 端仍直连 API（保留 `apiBaseForFetch`）。
- 页面数据加载统一模式：**createAsync + cache()**（SSR 序列化 + 客户端导航缓存命中，
  体验最佳，discover 即此模式）；或 **createResource + 页面级 Suspense 骨架**。
- 骨架屏样式依赖 stylex 客户端注入，页面骨架组件应放在入口可及模块（如
  route-skeletons.tsx），避免懒加载 chunk 首用无样式。
