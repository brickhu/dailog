import { describe, expect, it } from "vitest";
import { parseDoubaoPage } from "../../src/content/doubao";

describe("parseDoubaoPage（本地解析器：嵌套容器裁剪）", () => {
  it("逐轮嵌套结构：外层 turn 容器不重复包含后续轮次内容", () => {
    document.body.innerHTML = `
      <div data-message-id="turn-1" class="relative grid w-full">
        <div class="md-box-root">回答一</div>
        <div data-message-id="u-2" class="flex-row flex w-full justify-end">
          <div class="md-box-root">问题二</div>
        </div>
        <div data-message-id="turn-2" class="relative grid w-full">
          <div class="md-box-root">回答二</div>
          <div data-message-id="u-3" class="flex-row flex w-full justify-end">
            <div class="md-box-root">问题三</div>
          </div>
          <div data-message-id="turn-3" class="relative grid w-full">
            <div class="md-box-root">回答三</div>
          </div>
        </div>
      </div>
    `;
    const nodes = parseDoubaoPage(document);
    expect(nodes.length).toBe(5);
    // 外层 turn 容器只保留自己的内容（嵌套的后续轮次被裁剪），不整段重复
    expect(nodes.find((n) => n.id === "turn-1")?.content).toBe("回答一");
    expect(nodes.find((n) => n.id === "turn-2")?.content).toBe("回答二");
    expect(nodes.find((n) => n.id === "turn-3")?.content).toBe("回答三");
    expect(nodes.find((n) => n.id === "u-2")?.content).toBe("问题二");
    expect(nodes.find((n) => n.id === "u-3")?.content).toBe("问题三");
    // 角色：justify-end = user，grid = assistant
    expect(nodes.filter((n) => n.role === "user").map((n) => n.id)).toEqual(["u-2", "u-3"]);
    expect(nodes.filter((n) => n.role === "assistant").map((n) => n.id)).toEqual(["turn-1", "turn-2", "turn-3"]);
  });

  it("扁平结构（无嵌套）→ 提取不受影响", () => {
    document.body.innerHTML = `
      <div data-message-id="u-1" class="flex-row flex w-full justify-end"><div class="md-box-root">问题一</div></div>
      <div data-message-id="a-1" class="relative grid w-full"><div class="md-box-root">回答一</div></div>
    `;
    const nodes = parseDoubaoPage(document);
    expect(nodes.map((n) => n.content)).toEqual(["问题一", "回答一"]);
  });

  it("纯包装容器（裁剪后无内容）跳过", () => {
    document.body.innerHTML = `
      <div data-message-id="wrap" class="relative grid w-full">
        <div data-message-id="u-1" class="flex-row flex w-full justify-end"><div class="md-box-root">问题一</div></div>
      </div>
    `;
    const nodes = parseDoubaoPage(document);
    expect(nodes.map((n) => n.id)).toEqual(["u-1"]);
  });
});
