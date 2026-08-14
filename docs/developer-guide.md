# 开发指南（避坑手册）

> 记录开发过程中踩过的坑与解决方案。**新会话 / 新 Agent 接手前先读本文件**，
> 避免重复排查。每个坑都标注了根因、修复与"勿回退"注意事项。
> 最后更新：2026-08-14

## 1. StyleX dev 模式 FOUC —— 首帧无样式闪烁（已修复，勿回退）

### 现象
dev 环境（dailog.orb.local，vinxi dev）下每次加载页面，先出现无样式的 DOM 结构，
"晃一下"才渲染为有样式效果。

### 根因（两层问题叠加）
1. **CSS 链接是死链**：`@stylexjs/unplugin` 0.19 通过 transformIndexHtml 注入
   `<link rel="stylesheet" href="/_build/virtual:stylex.css">`（带 vinxi base 前缀 `/_build`），
   但它自己的 dev 中间件只匹配**无前缀**的 `/virtual:stylex.css`
   （`lib/consts.js` 的 `DEV_CSS_PATH`）→ 请求永远命中不了中间件，
   落到 vinxi 的 SPA fallback（返回 HTML 页面）→ 浏览器加载"CSS"失败、
   不阻塞渲染 → 首帧只有 stylex 类名、没有样式规则。
2. **样式收集为空**：`runtimeInjection: true`（默认）时模块样式被编译成 JS 注入调用，
   dev CSS 收集（`__stylexCollectCss`）为空 → 中间件返回 **0 字节** →
   样式只能等 `virtual:stylex:runtime` 脚本执行后注入 → 出现闪烁延迟。

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
curl -s http://dailog.orb.local/virtual:stylex.css | wc -c   # 应为非空（约 40KB）
curl -s http://dailog.orb.local/ | grep -o '<link[^>]*stylex[^>]*>'
# 应看到两个 link：/_build/virtual:stylex.css（死链，runtime 会禁用）+ /virtual:stylex.css（生效）
```

### 勿回退
- `runtimeInjection` 改回 `true` → 中间件又返回 0 字节，FOUC 复发。
- 删除 `fixStylexCssLink` 插件 → link 又变死链。
- 该修复只影响 dev；生产构建走 unplugin 构建期 CSS 提取（generateBundle 合并进 CSS asset），无此问题。

## 2. CSS Grid `1fr` 轨道的 min-content 陷阱（卡片被裁）

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

## 3. `overflow: hidden` 的裁剪边界是 padding 外缘（相邻分页冒头）

### 现象
滚屏展示中，第 2 屏的第 1 张卡片会从右侧露出一条（"第 5 期冒头"）。

### 根因
`overflow: hidden` 裁剪的是 **padding box**（含内边距区域），不是内容盒：
视口带左右 padding 时，轨道从内容区开始，相邻分页从内容区右缘开始 ——
其前 32px 正好落在视口的 padding 区域内、裁剪边界之内 → 露出来。

### 修复
左右内边距移到**每个分页（pagePane）内部**，视口自身无左右 padding →
裁剪边界 = 容器边缘 = 分页边缘，相邻分页整体在裁剪边界之外。
