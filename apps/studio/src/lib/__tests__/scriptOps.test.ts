import { describe, expect, it } from "vitest";
import { applyScriptOp, totalCharCount, type ScriptSegment } from "../scriptOps";
import { tryParseSegments } from "../parseJsonLoose";

const seg = (speaker: ScriptSegment["speaker"], text: string): ScriptSegment => ({ speaker, text });
const two = (): ScriptSegment[] => [seg("host", "你好"), seg("guest", "你好呀")];

describe("applyScriptOp", () => {
  it("updateText 修改指定段落", () => {
    expect(applyScriptOp(two(), { type: "updateText", index: 1, text: "改过了" })).toEqual([
      seg("host", "你好"),
      seg("guest", "改过了"),
    ]);
  });

  it("setSpeaker 切换发言者", () => {
    expect(applyScriptOp(two(), { type: "setSpeaker", index: 0, speaker: "guest" })[0]).toEqual(
      seg("guest", "你好"),
    );
  });

  it("remove 删除段落", () => {
    expect(applyScriptOp(two(), { type: "remove", index: 0 })).toEqual([seg("guest", "你好呀")]);
  });

  it("move 上移/下移并拒绝越界", () => {
    expect(applyScriptOp(two(), { type: "move", index: 1, dir: -1 })).toEqual([
      seg("guest", "你好呀"),
      seg("host", "你好"),
    ]);
    expect(applyScriptOp(two(), { type: "move", index: 0, dir: -1 })).toEqual(two());
  });

  it("insert 插入新段落", () => {
    expect(applyScriptOp(two(), { type: "insert", index: 1, segment: seg("host", "插入") })).toEqual([
      seg("host", "你好"),
      seg("host", "插入"),
      seg("guest", "你好呀"),
    ]);
  });

  it("越界 index 幂等", () => {
    expect(applyScriptOp(two(), { type: "updateText", index: 99, text: "x" })).toEqual(two());
    expect(applyScriptOp(two(), { type: "remove", index: -1 })).toEqual(two());
  });
});

describe("totalCharCount", () => {
  it("统计全稿字数（忽略空白）", () => {
    expect(totalCharCount([seg("host", "你好 世界"), seg("guest", "hi there")])).toBe(11);
  });
});

describe("tryParseSegments", () => {
  it("解析带围栏与杂文本的完整数组", () => {
    const out = tryParseSegments('```json\n[{"speaker":"host","text":"a"}]```');
    expect(out).toEqual([{ speaker: "host", text: "a" }]);
  });

  it("流式过程中不完整数组返回 null（等待更多数据）", () => {
    expect(tryParseSegments('[{"speaker":"host","text":"a"},')).toBeNull();
    expect(tryParseSegments("")).toBeNull();
  });

  it("非数组 JSON 返回 null", () => {
    expect(tryParseSegments('{"ok":true}')).toBeNull();
  });
});
