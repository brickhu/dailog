import { describe, expect, it } from "vitest";
import { dedupeSort, scrollCollect, type MessageNode } from "../src/content/core";

const mk = (id: string, offsetTop: number, role: MessageNode["role"]): MessageNode =>
  ({ id, offsetTop, role, content: `${id}-content` });

describe("dedupeSort", () => {
  it("dedupes by id and sorts by offsetTop", () => {
    const input = [mk("b", 200, "user"), mk("a", 100, "assistant"), mk("b", 200, "user")];
    const out = dedupeSort(input);
    expect(out.map((n) => n.id)).toEqual(["a", "b"]);
  });
});

describe("scrollCollect", () => {
  it("loops until no new nodes, then returns accumulated", async () => {
    let round = 0;
    const result = await scrollCollect({
      scrollToTop: async () => { round += 1; },
      readNodes: async () => {
        if (round === 1) return [mk("1", 100, "user")];
        if (round === 2) return [mk("1", 100, "user"), mk("2", 200, "assistant")];
        return [mk("1", 100, "user"), mk("2", 200, "assistant")]; // 稳定态
      },
      waitForMutation: async () => {},
      maxIterations: 10,
      settleRounds: 2,
    });
    expect(result.map((n) => n.id)).toEqual(["1", "2"]);
    // settle 语义：settleRounds=2 需要连续 2 轮无新增才 break。
    // round1 新增(1) → stable=0；round2 新增(2) → stable=0；
    // round3 无新增 → stable=1；round4 仍无新增 → stable=2 → break。共 4 轮。
    expect(round).toBe(4);
  });

  it("stops at maxIterations", async () => {
    let calls = 0;
    await scrollCollect({
      scrollToTop: async () => {},
      readNodes: async () => { calls += 1; return [mk(`${calls}`, calls, "user")]; },
      waitForMutation: async () => {},
      maxIterations: 3,
      settleRounds: 1,
    });
    expect(calls).toBe(3);
  });
});
