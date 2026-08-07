import { describe, expect, it, vi, beforeEach } from "vitest";
import { showCollectMask, hideCollectMask, updateMaskCount, setMaskDone, setMaskStatus } from "../../src/content/collect-mask";

beforeEach(() => {
  hideCollectMask();
  document.body.style.overflow = "";
});

describe("采集蒙层（阻断式）", () => {
  it("显示：创建 dailog-mask + 取消按钮 + 计数 + 锁定 body 滚动", () => {
    showCollectMask({ onCancel: () => {}, onDone: () => {} });
    const el = document.querySelector("[dailog-mask]");
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain("已截取 0 条");
    expect(document.body.style.overflow).toBe("hidden"); // 阻断页面滚动
  });

  it("阻断 wheel 事件（preventDefault）", () => {
    showCollectMask({ onCancel: () => {}, onDone: () => {} });
    const el = document.querySelector("[dailog-mask]")!;
    const wheel = new Event("wheel", { cancelable: true });
    el.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it("运行中主按钮=取消 → onCancel；完成后变「完成」→ onDone", () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    showCollectMask({ onCancel, onDone });
    const el = document.querySelector("[dailog-mask]")!;
    const btn = el.querySelector("button") as HTMLButtonElement;
    expect(btn.textContent).toBe("取消");
    btn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    setMaskDone();
    expect(btn.textContent).toBe("完成");
    btn.click();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1); // 完成态不再触发 onCancel
  });

  it("updateMaskCount / setMaskStatus 更新文案；隐藏移除并恢复滚动", () => {
    showCollectMask({ onCancel: () => {}, onDone: () => {} });
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
    showCollectMask({ onCancel: () => {}, onDone: () => {} });
    showCollectMask({ onCancel: () => {}, onDone: () => {} });
    expect(document.querySelectorAll("[dailog-mask]").length).toBe(1);
  });
});
