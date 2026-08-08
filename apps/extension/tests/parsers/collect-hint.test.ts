import { describe, expect, it, beforeEach } from "vitest";
import { showCollectHint, hideCollectHint, showScanline, hideScanline } from "../../src/content/collect-hint";

beforeEach(() => {
  hideCollectHint();
  hideScanline();
  document.body.style.overflow = "";
});

describe("采集提示条（非阻断——不拦截用户滚动/点击）", () => {
  it("显示：创建 dailog-hint 元素 + 默认文案 + 不锁 body 滚动", () => {
    showCollectHint();
    const el = document.querySelector("[dailog-hint]");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("进入视窗即选中");
    expect(document.body.style.overflow).toBe(""); // 不锁 body 滚动
    expect((el as HTMLElement).style.pointerEvents).toBe("none"); // 不拦截鼠标
  });

  it("自定义文案", () => {
    showCollectHint("自定义提示");
    expect(document.querySelector("[dailog-hint]")?.textContent).toBe("自定义提示");
  });

  it("幂等：重复显示不叠加", () => {
    showCollectHint();
    showCollectHint();
    expect(document.querySelectorAll("[dailog-hint]").length).toBe(1);
  });

  it("隐藏：移除元素", () => {
    showCollectHint();
    hideCollectHint();
    expect(document.querySelector("[dailog-hint]")).toBeNull();
  });

  it("不拦截 wheel 事件（无 preventDefault 监听）", () => {
    showCollectHint();
    const el = document.querySelector("[dailog-hint]")!;
    let defaultPrevented = false;
    const onWheel = (e: Event): void => { if (e.defaultPrevented) defaultPrevented = true; };
    document.documentElement.addEventListener("wheel", onWheel, { capture: true });
    el.dispatchEvent(new Event("wheel", { cancelable: true }));
    document.documentElement.removeEventListener("wheel", onWheel, { capture: true });
    expect(defaultPrevented).toBe(false);
  });
});

describe("扫码线（视窗中线扫描线）", () => {
  it("显示：创建 dailog-scanline 元素，纵向 50% 定位 + 不阻断交互", () => {
    showScanline();
    const el = document.querySelector("[dailog-scanline]");
    expect(el).not.toBeNull();
    expect((el as HTMLElement).style.top).toBe("50%");
    expect((el as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("幂等：重复显示不叠加；隐藏移除", () => {
    showScanline();
    showScanline();
    expect(document.querySelectorAll("[dailog-scanline]").length).toBe(1);
    hideScanline();
    expect(document.querySelector("[dailog-scanline]")).toBeNull();
  });
});
