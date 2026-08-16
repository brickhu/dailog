// 组件级 use:* 指令支持：
// Solid 的 use: 指令编译只作用于原生元素（jsxDOM 对组件上的 use: 不自动应用），
// 组件上的 use:xxx 会作为 "use:xxx" prop 传入组件——由组件读取 props 并通过本注册表
// 找到指令函数，应用到底层根元素。
// 使用：registerDirective("auth", authFn) 注册；组件内部
// getDirective("auth")?.(rootEl, () => props["use:auth"]) 应用。

/** 指令函数：接收元素 + 参数 accessor；可返回清理函数 */
export type DirectiveFn = (el: HTMLElement, accessor: () => unknown) => void | (() => void);

const registry = new Map<string, DirectiveFn>();

/** 注册指令（模块加载时调用；同名覆盖） */
export function registerDirective(name: string, fn: DirectiveFn): void {
  registry.set(name, fn);
}

/** 获取已注册的指令函数 */
export function getDirective(name: string): DirectiveFn | undefined {
  return registry.get(name);
}
