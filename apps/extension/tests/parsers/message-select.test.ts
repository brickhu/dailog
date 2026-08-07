import { describe, expect, it, beforeEach } from "vitest";
import { renderSelects, refreshSelects, selectedNodes, clearSelects } from "../../src/content/message-select";

beforeEach(() => clearSelects());

describe("采集确认态勾选框（message-select）", () => {
  it("renderSelects 给带 el 的节点注入勾选框（默认勾选）", () => {
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    document.body.append(el1, el2);
    renderSelects([{ el: el1 }, { el: el2 }]);
    const cbs = document.querySelectorAll("input[type=checkbox]");
    expect(cbs.length).toBe(2);
    expect((cbs[0] as HTMLInputElement).checked).toBe(true);
  });

  it("selectedNodes 按勾选状态过滤（取消勾选 = 剔除）", () => {
    const el1 = document.createElement("div");
    const el2 = document.createElement("div");
    document.body.append(el1, el2);
    const nodes = [{ el: el1 }, { el: el2 }];
    renderSelects(nodes);
    // 取消第一条的勾选
    const cbs = document.querySelectorAll("input[type=checkbox]");
    (cbs[0] as HTMLInputElement).checked = false;
    expect(selectedNodes(nodes).map((n) => n.el)).toEqual([el2]);
  });

  it("无 el 引用的节点视为保留（规则兜底兼容）", () => {
    const nodes = [{}, { el: undefined }];
    expect(selectedNodes(nodes).length).toBe(2);
  });

  it("clearSelects 移除全部勾选框并还原容器定位", () => {
    const el = document.createElement("div"); // 默认 static
    document.body.appendChild(el);
    renderSelects([{ el }]);
    expect(el.style.position).toBe("relative"); // static 容器临时设 relative
    clearSelects();
    expect(document.querySelectorAll("input[type=checkbox]").length).toBe(0);
    expect(el.style.position).toBe(""); // 还原
  });

  it("refreshSelects：虚拟列表重建消息 DOM 后重建选框并保留勾选状态", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const nodes = [{ el }];
    renderSelects(nodes);
    // 用户取消勾选
    const cb = el.querySelector("input[type=checkbox]") as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    // 模拟虚拟列表重建消息 DOM（checkbox 被移除）
    el.innerHTML = "";
    expect(el.querySelector("input[type=checkbox]")).toBeNull();
    // 定期重建
    refreshSelects(nodes);
    const rebuilt = el.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(rebuilt).not.toBeNull();
    expect(rebuilt.checked).toBe(false); // 勾选状态保留
  });
});
