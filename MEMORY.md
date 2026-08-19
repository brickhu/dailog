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
- [2026-08-17] stylex media 规则输出顺序随全局规则集变化（不稳定）——重叠断点（min-width 链）的“后者覆盖”会被破坏（大断点排到小断点前 → 桌面回退小断点列数）；断点一律用互斥 range 区间（`@media (640px <= width < 1024px)` / `@media (width >= 1024px)`），顺序无关才可靠
- [2026-08-17] StyleX dev 必须 runtimeInjection:true（每模块自带 _inject 同步注入 <style data-stylex>），否则 SPA 路由切换（点击进页面）样式迟到/丢、刷新才好；生产保持 false
- [2026-08-18] api 的 `column reference "id" is ambiguous`(Postgres 42702)是开发中间态的历史错误(05:57 集中出现后未重现)——当前 repo/index.ts 全部 JOIN 查询均带表前缀,无隐患;submissions 公开端点已补 uuid 校验(非 uuid → 404)
- [2026-08-20] studio 工程已废弃，不再维护/使用；开发与维护以 dailog 主工程为准
