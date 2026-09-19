// dev 首帧放行信号（供 entry-client 的 stylex-pre 移除逻辑使用）。
//
// 背景：dev 的样式由 unplugin runtimeInjection 逐模块注入（模块求值那一刻写进
// <style data-stylex>），而路由 chunk（src/routes/**）是懒加载的动态 import —— 它的
// 样式到达时间晚于壳模块。entry-client 只按「样式规则数稳定 180ms」放行时，路由 chunk
// 还在路上就会误判 → 页面内容先出现（壳样式），路由样式随后到达再重绘一次。
// app.tsx 的 RouterOutlet 在路由内容挂载后调用 markRouteStylesReady()，
// 这是「路由样式已就绪」的准确时刻（Solid hydration 会把 user effect 推迟到
// 路由内容渲染之后）。
//
// 生产构建：CSS 由构建期提取为单个文件（<link rel=stylesheet> render-blocking），
// 该信号不参与放行，调用本身无副作用。
let ready = false;
const waiters: Array<() => void> = [];

export function markRouteStylesReady(): void {
  if (ready) return;
  ready = true;
  const pending = waiters.splice(0);
  for (const fn of pending) fn();
}

export function whenRouteStylesReady(cb: () => void): void {
  if (ready) cb();
  else waiters.push(cb);
}
