import { describe, expect, it } from "vitest";
import { dedupeSort, groupIntoUnits, isCompleteUnit, messageKey, mergeUnitMembers, unitRect, type MessageNode } from "../src/content/core";

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

describe("isCompleteUnit（问答单元完整性：问和答都必须存在，消息不允许孤立）", () => {
  it("有问有答 → 完整", () => {
    const unit = { id: "u", messages: [mk("u1", 0, "user"), mk("a1", 100, "assistant")] };
    expect(isCompleteUnit(unit)).toBe(true);
  });
  it("光有问没有答（末尾未回答的追问）→ 不完整，不算问答单元", () => {
    const unit = { id: "u", messages: [mk("u1", 0, "user")] };
    expect(isCompleteUnit(unit)).toBe(false);
  });
  it("光有答没有问（窗口切分读到的 assistant 片段）→ 不完整，孤立消息不允许", () => {
    const unit = { id: "u", messages: [mk("a5", 0, "assistant")] };
    expect(isCompleteUnit(unit)).toBe(false);
  });
  it("一个问多个答（工具调用等）→ 完整", () => {
    const unit = { id: "u", messages: [mk("u1", 0, "user"), mk("a1", 100, "assistant"), mk("a2", 200, "assistant")] };
    expect(isCompleteUnit(unit)).toBe(true);
  });
});

describe("unitRect（问答单元几何：成员消息 rect 并集）", () => {
  const elAt = (top: number, bottom: number, left = 0, right = 200): Element =>
    ({ getBoundingClientRect: () => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) }) as unknown as Element;

  it("单元 = user + assistant 的并集（底边取 assistant）", () => {
    const unit = {
      id: "u",
      messages: [
        { id: "u", offsetTop: 0, role: "user" as const, content: "q", el: elAt(100, 200) },
        { id: "a", offsetTop: 0, role: "assistant" as const, content: "a", el: elAt(200, 600) },
      ],
    };
    expect(unitRect(unit)).toEqual({ top: 100, bottom: 600, left: 0, right: 200 });
  });
});

describe("mergeUnitMembers（选中单元成员合并：去重 + 内容只增不减）", () => {
  const mk = (id: string, role: MessageNode["role"], content: string): MessageNode =>
    ({ id, offsetTop: 0, role, content });

  it("窗口切分读到局部 → 合并不替换，已选内容不丢", () => {
    const target = { id: "u", messages: [mk("u1", "user", "问题"), mk("a1", "assistant", "回答")] };
    // 局部读取（只含 user）——合并后 assistant 保留
    mergeUnitMembers(target, { id: "u", messages: [mk("u1", "user", "问题")] });
    expect(target.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    // 补充完整读取——已存在成员去重
    mergeUnitMembers(target, { id: "u", messages: [mk("u1", "user", "问题"), mk("a1", "assistant", "回答")] });
    expect(target.messages.length).toBe(2);
  });

  it("内容只增不减（流式/截断中间态）+ 同键成员换新鲜 el（选区框几何）", () => {
    const target = { id: "u", messages: [mk("a1", "assistant", "完整回答 ABC")] };
    const elA = { tagName: "DIV" } as unknown as Element;
    const elB = { tagName: "DIV" } as unknown as Element;
    target.messages[0].el = elA;
    mergeUnitMembers(target, { id: "u", messages: [{ ...mk("a1", "assistant", "完整回答 AB"), el: elB }] }); // 截断
    expect(target.messages[0].content).toBe("完整回答 ABC"); // 内容保留
    expect(target.messages[0].el).toBe(elB); // el 换新鲜
    mergeUnitMembers(target, { id: "u", messages: [mk("a1", "assistant", "完整回答 ABCDEF")] }); // 流式增长
    expect(target.messages[0].content).toBe("完整回答 ABCDEF");
  });

  it("新成员按 incoming 文档序追加（多 assistant）", () => {
    const target = { id: "u", messages: [mk("u1", "user", "q")] };
    mergeUnitMembers(target, { id: "u", messages: [mk("u1", "user", "q"), mk("a1", "assistant", "a1"), mk("a2", "assistant", "a2")] });
    expect(target.messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
  });
});
