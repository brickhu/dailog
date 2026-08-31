# MEMORY — 跨会话长期记忆（由 remember skill 维护）

## 2026-08-16 · 坑清单（一次大任务沉淀）

- 前端数据获取原则：非必要不把数据获取放 onMount（createAsync/createResource/createEffect 优先，见 AGENT.md）
- @iconify/utils 的 loadIcon 不访问网络（无图标集恒 undefined）——按需注入用 api.iconify.design 的 SVG 端点
- StyleX 不支持 `> *` 子选择器与 create 内 spread 另一个 create；flex 纵列子项需 flexShrink:0（header 曾被压到 34px）
- Solid 1.9：lazy props（icon={<Icon/>}）与组件上的 use: 指令都会 hydration mismatch——children() 包装 + ui 指令注册表（registerDirective）；use: 必须带值（use:auth={true}）
- async 事件拦截必须同步 preventDefault/stopPropagation（await 挂起期间事件继续冒泡、onClick 先执行）
- createAsync/createResource 的 SSR 短路 null 会被序列化、客户端不再重新请求——SSR 用 apiBaseForFetch 直取数据
- 同 pathname 不同 query 的客户端 navigate 不重挂载（onMount 不重跑）——用 createEffect 响应 query 变化
- 浏览器端 API 请求必须走 site 同源代理（/v1/*），否则 SPA fallback 返回 200+HTML 导致登录态误判
- 坑全集：developer-guide.md §1–§10（FOUC / transition / grid min-content / 壳布局 / HMR ws TLS / loadIcon / CORS 代理 / lazy props 等）
- [2026-08-17] stylex media 规则输出顺序随全局规则集变化（不稳定）——重叠断点（min-width 链）的“后者覆盖”会被破坏（大断点排到小断点前 → 桌面回退小断点列数）；断点一律用互斥 range 区间（`@media (min-width: 640px) and (max-width: 1024px)` / `@media (min-width: 1025px)`），顺序无关才可靠；2026-08-21 生产实测复现（theme TABLET `width >= 640px` 与 DESKTOP `width >= 1024px` 重叠，构建抽取 640 排到 1024 后 → containerLg 桌面回退 8 列）——已全仓统一上述互斥 range（TABLET 640-1024 / DESKTOP ≥1025，min-width/max-width 语法）
- [2026-08-17] StyleX dev 必须 runtimeInjection:true（每模块自带 _inject 同步注入 <style data-stylex>），否则 SPA 路由切换（点击进页面）样式迟到/丢、刷新才好；生产保持 false
- [2026-08-18] api 的 `column reference "id" is ambiguous`(Postgres 42702)是开发中间态的历史错误(05:57 集中出现后未重现)——当前 repo/index.ts 全部 JOIN 查询均带表前缀,无隐患;submissions 公开端点已补 uuid 校验(非 uuid → 404)
- [2026-08-20] studio 工程已废弃，不再维护/使用；开发与维护以 dailog 主工程为准
- [2026-08-20] 新开发组件的所有外部样式传递统一用 xstyle prop（stylex.create 产物，内部 stylex.props(内部, props.xstyle) 单次合并，外部在后冲突属性胜出）；勿把 {...stylex.props(x)} spread 进自定义组件（类名只拼接不合并、覆盖不可靠），spread 仅用于原生元素/<A>
- [2026-08-21] CF Pages SPA fallback 会把缺失的 /_build/assets/*.js 顶替成 200+text/html（immutable 缓存一年）——浏览器当 JS 解析报 MIME 错误 → hydration 中断 → 图标/CSS/交互全失效（iOS 登录跳回首页复现）。修复：①CF dashboard Not found handling 改 404-page（仓库外必改）；②sw.js VERSION v3 + 缓存前校验 Content-Type（text/html 不缓存 + 命中坏条目删除回源）；③登录/登出改 SPA 内导航（LoginForm navigate prop）+ AuthProvider context（lib/auth.tsx，useAuth 响应式联动 Header）——禁止整页刷新登录跳转。详见 developer-guide §11；2026-08-21 sw.js 升 v4：资产/壳分支对 text/html 坏响应用 fetch(cache:"reload") 绕过浏览器 immutable 缓存重试，仍坏回缓存好条目/404——部署窗口期被污染的浏览器 HTTP 缓存（1 年 immutable）"刷新都不行"由它自愈
- [2026-08-21] 【红线】绝对禁止 kill 端口/进程（lsof+kill、pkill 等）——orb compose 的 site 容器映射 host 3000:80，kill 3000 端口会直接杀掉 orb site 服务并连累全家桶（曾致 site/pg 退出、api 重启循环）；需要重启 SSR 用 `docker compose restart dailog`，恢复全家桶用 `docker compose up -d`；验证尽量只读，host 上不得再起占用 3000 的 dev server（与 orb 端口冲突）
- [2026-08-21] stylex 样式值必须是模板字符串（`padding: ${dimensions.spacing1} ${dimensions.spacing3}`）；写成普通字符串 "${...}" 字面量 → dev 仅样式失效、**生产 vinxi build 编译直接报错**（Error building router ssr）
- [2026-08-21] Solid SSR 把 `#{tag}`/i18n 插值拆成多个文本节点（# + 注释 + 文本），按连续文本 grep 匹配不到——验证渲染用结构定位（按 class 找元素）而非文本 grep
- [2026-08-21] dev/prod 样式交付不同：dev runtimeInjection（<style data-stylex>，/_build/virtual:stylex.css 是坏链返回 HTML），prod 构建抽取独立 CSS；哈希类名两环境可能不同（同元素 dev xpt1uts / prod xl2fkol）——对比样式别 curl 抓 CSS 文件，按 HTML 类名 + prod CSS 覆盖分析
- [2026-08-21] api dev 容器（tsx watch）崩溃重启后旧子进程可能残留占 8787（响应旧代码）——touch 触发 supervisor 重启无效时用 `docker restart api`（dev-supervisor 注释认可的恢复手段）
- [2026-08-21] 排查部署先确认环境：生产 = candelbot.app / api.candelbot.app；dailog.fm / api.dailog.fm 是另一套旧环境（数据空、公开端点 401）——别拿错环境验证
- [2026-08-21] 协作坑：编辑器开着旧缓冲保存会整体覆盖磁盘上 agent 已改的新文件（曾致 [slug].tsx 改动全丢）——agent 改完文件要提醒用户重新加载/关闭旧缓冲
- [2026-08-21] StyleX 编译红线（site dev 容器整体 503 的根因）：①stylex.create 禁跨文件导入常量（DESKTOP/TABLET 须本地写同值字面量，theme.stylex.ts 注释有约定）；②stylex.props 条件禁引用 local/splitProps 与组件内 const；③条件必须写成直接引用 props 的裸调用表达式 `isSize("sm") && style`，禁 `fn() === x` 二元式/`!!x`——会被编译期静态求值炸 Unsupported expression。新组件照 button.tsx 的 isSize/isVariant 约定写
- [2026-08-31] 语感打磨保持单轮批量 + 防回显自动重试（不做多轮对话）；下一环节议题：①语音片段可否浏览器 Wasm 直接合成 ②audio1→audio2 段间间隔控制

