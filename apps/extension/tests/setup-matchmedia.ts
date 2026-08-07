// jsdom 未实现 window.matchMedia（已知缺口）——提供最小 polyfill，
// 供 print-emulation 等依赖 matchMedia 的测试使用（jsdom project setupFiles）
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// 测试标记：让 print-emulation-main 的导入期 IIFE 跳过（否则测试里捕获的
// matchMedia 引用是被 patch 过的包装，恢复后出现双包装问题）
(window as unknown as Record<string, unknown>).__DAILOG_TEST__ = true;
