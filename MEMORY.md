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
