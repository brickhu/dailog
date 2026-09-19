import { createEffect, createSignal, type Accessor } from "solid-js";

// 客户端专用异步数据的取值（登录态/收藏态等 SSR 拿不到的 createResource）。
//
// 为什么不能直接在 JSX 里读 resource（或 resource.latest）：
// 页面级 <Suspense>（layouts/page.tsx）在 hydration 时会重新渲染它的 children；
// 若渲染期读到一个"只在客户端才开始请求"的资源（SSR 端 source 短路为 null →
// 服务端没序列化 → 客户端 hydration 时才 fetch），Solid 会把这个资源计入当前
// Suspense 的 pending（client createResource 的 c.increment）→ 边界切回 fallback
// DOM；而 fallback 在 SSR 是 noHydrate 渲染的（无 data-hk，且流式内容到达后已被
// $df 替换）→ 抛 "Hydration Mismatch. Unable to find DOM nodes for hydration key"。
// （服务端已序列化的资源不受影响：resolved=true 时 .latest 不触发 read()，安全。）
//
// 读放在 createEffect —— user computation（Listener.user === true）里，read() 不会
// increment Suspense；且 hydration 期间 user effect 会排队到 hydration 完成后才执行
// → 首帧渲染 initial（与服务端渲染一致），取到值后经 signal 更新 DOM。
export function createClientValue<T>(read: () => T | undefined, initial: T): Accessor<T> {
  const [value, setValue] = createSignal<T>(initial);
  createEffect(() => {
    const next = read();
    if (next !== undefined) setValue(() => next as T);
  });
  return value;
}
