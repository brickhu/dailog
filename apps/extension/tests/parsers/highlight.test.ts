import { describe, expect, it, beforeEach } from "vitest";
import { highlightNodes, clearHighlight, unhighlightNodes } from "../../src/content/highlight";

beforeEach(() => {
  document.body.innerHTML = "";
  clearHighlight();
});

describe("滚动采集进度高亮（highlightNodes / clearHighlight）", () => {
  it("给带 el 引用的消息加高亮 class（幂等：重复调用不报错）", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    highlightNodes([{ el }, { el }]); // 同一节点重复出现
    highlightNodes([{ el }]);
    expect(el.classList.contains("dailog-scan-highlight")).toBe(true);
    expect(document.querySelectorAll(".dailog-scan-highlight").length).toBe(1);
  });

  it("无 el 引用的节点（规则兜底）跳过", () => {
    highlightNodes([{}, { el: undefined }]);
    expect(document.querySelectorAll(".dailog-scan-highlight").length).toBe(0);
  });

  it("clearHighlight 清除全部高亮与注入样式", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    highlightNodes([{ el }]);
    expect(document.querySelector("style")?.textContent).toContain("dailog-scan-in");
    clearHighlight();
    expect(el.classList.contains("dailog-scan-highlight")).toBe(false);
    expect(document.querySelectorAll("style[data-dailog-scan]").length).toBe(0);
  });

  it("unhighlightNodes 移除指定节点高亮（向下滚取消选区）", () => {
    const elA = document.createElement("div");
    const elB = document.createElement("div");
    document.body.append(elA, elB);
    highlightNodes([{ el: elA }, { el: elB }]);
    unhighlightNodes([{ el: elA }]);
    expect(elA.classList.contains("dailog-scan-highlight")).toBe(false);
    expect(elB.classList.contains("dailog-scan-highlight")).toBe(true);
  });
});
