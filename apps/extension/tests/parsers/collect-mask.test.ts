import { describe, expect, it, vi, beforeEach } from "vitest";
import { showCollectMask, hideCollectMask, updateMaskCount, setMaskDone, setMaskStatus } from "../../src/content/collect-mask";

beforeEach(() => {
  hideCollectMask();
  document.body.style.overflow = "";
});

describe("步进截取蒙层（阻断式）", () => {
  it("显示：创建 dailog-mask + 上/取消按钮 + 计数 + 锁定 body 滚动", () => {
    showCollectMask({ onUp: () => {}, onCancel: () => {}, onDone: () => {} });
    const el = document.querySelector("[dailog-mask]");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("已截取 0 条");
    expect(document.body.style.overflow).toBe("hidden"); // 阻断页面滚动
  });

  it("阻断 wheel 事件（preventDefault）", () => {
    showCollectMask({ onUp: () => {}, onCancel: () => {}, onDone: () => {} });
    const el = document.querySelector("[dailog-mask]")!;
    const wheel = new Event("wheel", { cancelable: true });
    el.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("点「上」→ onUp；到顶后变「完成」→ onDone", () => {
    const onUp = vi.fn();
    const onDone = vi.fn();
    showCollectMask({ onUp, onCancel: () => {}, onDone });
    const el = document.querySelector("[dailog-mask]")!;
    const buttons = el.querySelectorAll("button");
    (buttons[0] as HTMLButtonElement).click();
    expect(onUp).toHaveBeenCalledTimes(1);
    setMaskDone();
    expect(buttons[0].textContent).toBe("完成");
    (buttons[0] as HTMLButtonElement).click();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onUp).toHaveBeenCalledTimes(1); // 完成态不再触发 onUp
  });

  it("点「取消」→ onCancel", () => {
    const onCancel = vi.fn();
    showCollectMask({ onUp: () => {}, onCancel, onDone: () => {} });
    const el = document.querySelector("[dailog-mask]")!;
    const buttons = el.querySelectorAll("button");
    (buttons[1] as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalled();
  });

  it("updateMaskCount / setMaskStatus 更新文案；隐藏移除并恢复滚动", () => {
    showCollectMask({ onUp: () => {}, onCancel: () => {}, onDone: () => {} });
    updateMaskCount(12);
    setMaskStatus("测试状态");
    const el = document.querySelector("[dailog-mask]")!;
    expect(el.textContent).toContain("已截取 12 条");
    expect(el.textContent).toContain("测试状态");
    hideCollectMask();
    expect(document.querySelector("[dailog-mask]")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("幂等：重复显示不叠加", () => {
    showCollectMask({ onUp: () => {}, onCancel: () => {}, onDone: () => {} });
    showCollectMask({ onUp: () => {}, onCancel: () => {}, onDone: () => {} });
    expect(document.querySelectorAll("[dailog-mask]").length).toBe(1);
  });
});
