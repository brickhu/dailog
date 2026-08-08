import { describe, expect, it, beforeEach } from "vitest";
import { renderUnitBoxes, clearUnitBoxes } from "../../src/content/unit-boxes";
import type { QaUnit } from "../../src/content/core";

const elAt = (top: number, bottom: number, left = 0, right = 200): Element =>
  ({ getBoundingClientRect: () => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) }) as unknown as Element;

const unitOf = (id: string, top: number, bottom: number): QaUnit => ({
  id,
  messages: [{ id, offsetTop: 0, role: "user", content: id, el: elAt(top, bottom) }],
});

beforeEach(() => {
  clearUnitBoxes();
});

describe("问答单元选区框（renderUnitBoxes / clearUnitBoxes）", () => {
  it("为已选单元画绿色边框框（覆盖单元容器范围）", () => {
    renderUnitBoxes([unitOf("u1", 100, 400), unitOf("u2", 500, 800)]);
    const root = document.querySelector("[dailog-unit-boxes]");
    expect(root).not.toBeNull();
    const boxes = root!.querySelectorAll("div");
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLElement).style.border).toContain("rgba(74, 222, 128");
    expect((boxes[0] as HTMLElement).style.top).toBe("100px");
    expect((boxes[0] as HTMLElement).style.height).toBe("300px");
  });

  it("滚动刷新：几何变化更新位置，取消的单元移除框", () => {
    renderUnitBoxes([unitOf("u1", 100, 400)]);
    // 模拟滚动后几何变化 + u1 被取消、u2 新增
    renderUnitBoxes([unitOf("u1", 200, 500), unitOf("u2", 600, 900)]);
    const root = document.querySelector("[dailog-unit-boxes]")!;
    const boxes = root.querySelectorAll("div");
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLElement).style.top).toBe("200px"); // 位置已刷新
  });

  it("无有效几何（成员被回收）→ 不画框", () => {
    const unit: QaUnit = { id: "u", messages: [{ id: "u", offsetTop: 0, role: "user", content: "q" }] }; // 无 el
    renderUnitBoxes([unit]);
    expect(document.querySelector("[dailog-unit-boxes]")?.querySelectorAll("div").length).toBe(0);
  });

  it("clearUnitBoxes 清除全部框与容器", () => {
    renderUnitBoxes([unitOf("u1", 100, 400)]);
    clearUnitBoxes();
    expect(document.querySelector("[dailog-unit-boxes]")).toBeNull();
  });
});
