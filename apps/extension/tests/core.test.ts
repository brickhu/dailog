import { describe, expect, it } from "vitest";
import { dedupeSort, findRangeIndex, type MessageNode } from "../src/content/core";

const mk = (id: string, offsetTop: number, role: MessageNode["role"]): MessageNode =>
  ({ id, offsetTop, role, content: `${id}-content` });

describe("dedupeSort", () => {
  it("dedupes by id and sorts by offsetTop", () => {
    const input = [mk("b", 200, "user"), mk("a", 100, "assistant"), mk("b", 200, "user")];
    const out = dedupeSort(input);
    expect(out.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("findRangeIndex（范围选区定位：id 优先，内容键兜底）", () => {
  const range = [
    { ...mk("m0", 0, "user"), content: "q0" },
    { ...mk("m1", 100, "assistant"), content: "a1" },
    { ...mk("m2", 200, "user"), content: "q2" },
  ];

  it("按 id 定位", () => {
    expect(findRangeIndex(range, { id: "m1", role: "assistant", content: "a1" })).toBe(1);
  });

  it("id 不可靠（rule-N 跨窗口变化）→ 内容键兜底", () => {
    expect(findRangeIndex(range, { id: "rule-9", role: "assistant", content: "a1" })).toBe(1);
  });

  it("不存在 → -1（不收缩）", () => {
    expect(findRangeIndex(range, { id: "m9", role: "user", content: "x" })).toBe(-1);
  });
});
