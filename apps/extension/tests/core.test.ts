import { describe, expect, it } from "vitest";
import { dedupeSort, groupIntoUnits, isUnitSelected, messageKey, type MessageNode } from "../src/content/core";

const mk = (id: string, offsetTop: number, role: MessageNode["role"]): MessageNode =>
  ({ id, offsetTop, role, content: `${id}-content` });

describe("dedupeSort", () => {
  it("dedupes by id and sorts by offsetTop", () => {
    const input = [mk("b", 200, "user"), mk("a", 100, "assistant"), mk("b", 200, "user")];
    const out = dedupeSort(input);
    expect(out.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("messageKey（稳定键：id 优先，序列 id 用内容键）", () => {
  it("稳定 id 直接用", () => {
    expect(messageKey(mk("m1", 0, "user"))).toBe("m1");
  });
  it("序列 id（rule-/gen-N 窗口下标不可靠）→ role+content 内容键", () => {
    const n = { ...mk("rule-3", 0, "user"), content: "你好" };
    expect(messageKey(n)).toBe("user\u0000你好");
    expect(messageKey({ ...n, id: "gen-2" })).toBe("user\u0000你好");
  });
});

describe("groupIntoUnits（问答单元：user 起头，assistant 归属前一单元）", () => {
  it("一问一答交替分组", () => {
    const nodes = [mk("u1", 0, "user"), mk("a1", 100, "assistant"), mk("u2", 200, "user"), mk("a2", 300, "assistant")];
    const units = groupIntoUnits(nodes);
    expect(units.length).toBe(2);
    expect(units[0].messages.map((n) => n.id)).toEqual(["u1", "a1"]);
    expect(units[1].messages.map((n) => n.id)).toEqual(["u2", "a2"]);
  });

  it("一个 user 后多个 assistant（工具调用等）归同一单元", () => {
    const nodes = [mk("u1", 0, "user"), mk("a1", 100, "assistant"), mk("a2", 200, "assistant")];
    const units = groupIntoUnits(nodes);
    expect(units.length).toBe(1);
    expect(units[0].messages.map((n) => n.id)).toEqual(["u1", "a1", "a2"]);
  });

  it("assistant 开头（窗口切分片段）单独成组，由调用方按成员匹配", () => {
    const nodes = [mk("a5", 0, "assistant"), mk("u6", 100, "user"), mk("a6", 200, "assistant")];
    const units = groupIntoUnits(nodes);
    expect(units.length).toBe(2);
    expect(units[0].messages.map((n) => n.id)).toEqual(["a5"]);
    expect(units[1].messages.map((n) => n.id)).toEqual(["u6", "a6"]);
  });
});

describe("isUnitSelected（扫码线判定：底边扫过中线即选中）", () => {
  // core.test 为 node 环境（无 document）——用纯对象 mock 元素
  const elAt = (top: number, bottom: number): Element =>
    ({ getBoundingClientRect: () => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: 0, toJSON: () => ({}) }) }) as unknown as Element;
  const unitOf = (top: number, bottom: number): ReturnType<typeof groupIntoUnits>[number] => ({
    id: "u",
    messages: [{ id: "u", offsetTop: 0, role: "user", content: "q", el: elAt(top, bottom) }],
  });

  it("底边在中线之上（已扫过）→ 选中", () => {
    expect(isUnitSelected(unitOf(100, 300), 400, 800)).toBe(true);
  });
  it("底边在中线之下（未扫过）→ 未选中", () => {
    expect(isUnitSelected(unitOf(300, 500), 400, 800)).toBe(false);
  });
  it("向下滚回中线以下 → 取消（同一判定）", () => {
    const u = unitOf(300, 500);
    expect(isUnitSelected(u, 400, 800)).toBe(false);
  });
  it("超视口高的单元：顶边扫过中线即选中（底边永远无法越过中线）", () => {
    // 高 1000px > 视口 800px：底边 900 > 中线 400，但顶边 300 < 400 → 选中
    expect(isUnitSelected(unitOf(300, 1300), 400, 800)).toBe(true);
    // 顶边尚未扫过 → 未选中
    expect(isUnitSelected(unitOf(500, 1500), 400, 800)).toBe(false);
  });
});
