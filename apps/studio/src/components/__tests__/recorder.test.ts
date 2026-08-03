// @vitest-environment happy-dom
// solid JSX 编译产物模块顶层调用 delegateEvents（事件委托），需 DOM 环境
import { describe, expect, it } from "vitest";
import { recorderReducer, type RecorderPhase } from "../recorder";

describe("recorderReducer", () => {
  const cases: Array<{ from: RecorderPhase; event: Parameters<typeof recorderReducer>[1]; to: RecorderPhase }> = [
    { from: "idle", event: { type: "start" }, to: "recording" },
    { from: "recording", event: { type: "stop" }, to: "recorded" },
    { from: "recorded", event: { type: "start" }, to: "recording" }, // 重录覆盖
    { from: "recorded", event: { type: "discard" }, to: "idle" },
    { from: "idle", event: { type: "discard" }, to: "idle" }, // 非法事件幂等
  ];

  for (const { from, event, to } of cases) {
    it(`${from} + ${event.type} → ${to}`, () => {
      expect(recorderReducer(from, event)).toBe(to);
    });
  }

  it("stop 在非 recording 态是幂等的", () => {
    expect(recorderReducer("idle", { type: "stop" })).toBe("idle");
    expect(recorderReducer("recorded", { type: "stop" })).toBe("recorded");
  });
});
