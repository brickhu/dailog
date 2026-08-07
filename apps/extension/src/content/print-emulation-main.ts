// MAIN world 打印媒体模拟：覆盖 window.matchMedia，让站点 JS 的 print 监听
// 认为页面处于打印模式（打印模式下 claude 等站点会全量渲染虚拟列表）。
// 与 ISOLATED world 的 CSSOM 打印规则提取（print-css.ts）互补：一个管 JS 监听，一个管 CSS 规则。
// 零额外权限（content_scripts world: "MAIN" 为常规机制），过审友好。

/** 导出便于测试；扩展里作为独立 bundle 在 MAIN world 立即执行 */
export function patchPrintMedia(win: Window): void {
  const w = win as unknown as Record<string, unknown>;
  if (w.__dailogPrintPatched) return;
  if (typeof win.matchMedia !== "function") return; // 环境无 matchMedia（如旧 jsdom）跳过
  w.__dailogPrintPatched = true;

  const orig = win.matchMedia.bind(win);
  win.matchMedia = ((query: string) => {
    const mql = orig(query);
    if (!/print/i.test(query)) return mql;
    const listeners: Array<(ev: MediaQueryListEvent) => void> = [];
    if (!mql.matches) {
      // 模拟进入打印媒体：异步触发一次 change 监听（同步读取 matches 已为 true）
      setTimeout(() => {
        listeners.forEach((cb) => cb({ matches: true, media: query } as MediaQueryListEvent));
      }, 0);
    }
    return {
      matches: true,
      media: query,
      onchange: null,
      addEventListener: (type: string, cb: (ev: MediaQueryListEvent) => void) => {
        if (type === "change") listeners.push(cb);
      },
      removeEventListener: (type: string, cb: (ev: MediaQueryListEvent) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
      addListener: (cb: (ev: MediaQueryListEvent) => void) => listeners.push(cb),
      removeListener: (cb: (ev: MediaQueryListEvent) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof win.matchMedia;
}

// MAIN world 直接执行（manifest world: "MAIN" 注入）；测试环境（__DAILOG_TEST__）跳过，
// 由测试显式调用 patchPrintMedia（避免导入期副作用污染 matchMedia 引用捕获）
if (
  typeof window !== "undefined" &&
  !(window as unknown as Record<string, unknown>).__DAILOG_TEST__
) {
  patchPrintMedia(window);
}
