import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { patchPrintMedia } from "../../src/content/print-emulation-main";

const origMatchMedia = window.matchMedia.bind(window);

afterEach(() => {
  window.matchMedia = origMatchMedia;
  delete (window as unknown as Record<string, unknown>).__dailogPrintPatched;
});

describe("patchPrintMedia（MAIN world 打印媒体模拟）", () => {
  beforeEach(() => { patchPrintMedia(window); });

  it("print 查询 → matches 恒为 true", () => {
    expect(window.matchMedia("print").matches).toBe(true);
    expect(window.matchMedia("print").media).toBe("print");
  });

  it("非 print 查询 → 原样返回", () => {
    const mql = window.matchMedia("(max-width: 100px)");
    expect(mql.matches).toBe(false); // jsdom 视口不匹配窄屏
    expect(mql.matches).toBe(origMatchMedia("(max-width: 100px)").matches);
  });

  it("print 的 change 监听被触发（模拟进入打印媒体）", async () => {
    const mql = window.matchMedia("print");
    const onChange = vi.fn();
    mql.addEventListener("change", onChange);
    await new Promise((r) => setTimeout(r, 10));
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0].matches).toBe(true);
  });

  it("removeEventListener 生效", async () => {
    const mql = window.matchMedia("print");
    const onChange = vi.fn();
    mql.addEventListener("change", onChange);
    mql.removeEventListener("change", onChange);
    await new Promise((r) => setTimeout(r, 10));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("重复 patch 幂等（__DAILOG_TEST__ 标记 + 补丁标记防重复包装）", () => {
    patchPrintMedia(window);
    expect(window.matchMedia("print").matches).toBe(true);
    // 补丁标记已设置；再次 patch 走守卫直接返回
    expect((window as unknown as Record<string, unknown>).__dailogPrintPatched).toBe(true);
    patchPrintMedia(window);
    expect(window.matchMedia("print").matches).toBe(true);
  });
});
