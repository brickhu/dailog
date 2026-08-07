import { describe, expect, it, beforeEach } from "vitest";
import { showCollectOverlay, hideCollectOverlay } from "../../src/content/collect-overlay";

beforeEach(() => hideCollectOverlay());

describe("采集蒙层（showCollectOverlay / hideCollectOverlay）", () => {
  it("显示：创建全屏蒙层 + 锁定 body 滚动", () => {
    showCollectOverlay();
    const overlay = document.querySelector("div[dailog-overlay]") as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("正在采集中");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("幂等：重复显示不叠加", () => {
    showCollectOverlay();
    showCollectOverlay();
    expect(document.querySelectorAll("div[dailog-overlay]").length).toBe(1);
  });

  it("隐藏：移除蒙层并恢复滚动", () => {
    document.body.style.overflow = "auto";
    showCollectOverlay();
    hideCollectOverlay();
    expect(document.querySelector("div[dailog-overlay]")).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });
});
