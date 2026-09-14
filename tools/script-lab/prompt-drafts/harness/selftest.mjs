// 闸门自检：每道网都用合成数据捅一遍。跑 `node selftest.mjs`，全绿才算闸门是活的。
import { checkScript } from "./gates.mjs";

const msgs = [
  { role: "user", content: "灯带开灯要等一分钟才亮，是什么原因？我不想换整条灯带。" },
  { role: "assistant", content: "最可能是驱动器内置了软启动保护，它在故意慢启动。电容老化也会导致充电慢。" },
  { role: "user", content: "那怎么判断是哪种？" },
  { role: "assistant", content: "正常软启动只延迟几秒，长达一分钟就可能是故障了。" },
];
const H = "大家好，我是飞。今天我们和 dailog 的 AI 嘉宾DeepSeek一起聊聊「灯带延迟」这个话题。";
const G = "大家好，我是DeepSeek。你好啊，飞！你这个话题很有意思！";
const END = "好，那么我们就聊到这里，感谢大家收听 dailog，我们下期见！";
const pair = (q, a) => ([{ speaker: "host", kind: "new", text: q }, { speaker: "guest", kind: "new", text: a }]);
const base = () => [{ speaker: "host", kind: "new", text: H }, { speaker: "guest", kind: "new", text: G }]
  .concat(pair("灯带开灯要等一分钟才亮是什么原因？", "最可能是驱动器内置了软启动保护。电容老化也会导致充电慢。"))
  .concat(pair("那怎么判断是哪种？", "正常软启动只延迟几秒，长达一分钟就可能是故障了。"))
  .concat(pair("那换个开关能试出来吗？", "可以，直接给灯带通电，跳过触摸开关看看。"))
  .concat(pair("那解决办法是什么？", "直接换驱动器，注意电压和功率要匹配。"))
  .concat(pair("明白了。", "对，先换驱动器试试。"))
  .concat([{ speaker: "host", kind: "new", text: "OK，感谢DeepSeek。" }, { speaker: "guest", kind: "new", text: "不客气。总的来说：先换开关做对比测试，锁定驱动器电容老化。" }, { speaker: "host", kind: "new", text: END }]);

let ok = 0, bad = 0;
function expect(code, lines, note, level) {
  const r = checkScript({ lines }, msgs);
  const pool = level === "warn" ? r.warnings : r.errors;
  const hit = pool.some(e => e.code === code);
  if (hit) { ok++; console.log("  ✓ " + code + "  (" + note + ")"); } else { bad++; console.log("  ✗ " + code + "  没触发！(" + note + ")"); }
}
console.log("基线（应当无硬伤）：");
const r0 = checkScript({ lines: base() }, msgs);
if (r0.errors.length === 0) { ok++; console.log("  ✓ 基线无硬伤"); } else { bad++; console.log("  ✗ 基线有硬伤：" + r0.errors.map(e => e.code).join(",")); }

console.log("结构类：");
expect("NO_LINES", [], "空稿");
expect("EMPTY_TEXT", base().concat([{ speaker: "host", kind: "new", text: "   " }]), "空台词");
expect("MONOLOGUE", [{ speaker: "host", kind: "new", text: H }, { speaker: "host", kind: "new", text: "那怎么判断？" }, { speaker: "host", kind: "new", text: "那换个开关呢？" }].concat(base().slice(2)), "同一人连说三段");
expect("SAME_SPEAKER", [{ speaker: "host", kind: "new", text: H }, { speaker: "host", kind: "new", text: "那怎么判断？" }].concat(base().slice(2)), "同一人连说两段", "warn");
expect("CLOSING_SHAPE", base().slice(0, -1).concat([{ speaker: "guest", kind: "new", text: "那就这样。" }]), "结尾不是收播语");
expect("SHELL_WORD", base().slice(0, 4).concat([{ speaker: "host", kind: "new", text: "感谢收听，我们下期再见。" }]).concat(base().slice(4)), "对手戏里出现壳词");
console.log("规格类：");
expect("TOO_MANY_TURNS", [{ speaker: "host", kind: "new", text: H }, { speaker: "guest", kind: "new", text: G }].concat(Array.from({ length: 21 }, () => pair("那还有什么要注意的？", "注意匹配电压和功率。")).flat()).concat([{ speaker: "host", kind: "new", text: "OK，感谢DeepSeek。" }, { speaker: "guest", kind: "new", text: "不客气。总的来说：先换开关。" }, { speaker: "host", kind: "new", text: END }]), "回合数超过 20");
expect("READING_ALOUD", base().slice(0, 2).concat([{ speaker: "host", kind: "new", text: "那具体怎么排查？" }, { speaker: "guest", kind: "new", text: "先说结论。" + "排查步骤包括测量电压、检查电容、更换开关、对比测试等等。".repeat(12) }]).concat(base().slice(4)), "嘉宾一段念稿");
console.log("内容类：");
expect("NUMBER_MISMATCH", base().slice(0, 2).concat([{ speaker: "host", kind: "new", text: "那要等多久？" }, { speaker: "guest", kind: "new", text: "大概要等 45 分钟才能完全启动。" }]).concat(base().slice(4)), "编造原文没有的数字");
expect("DANGLING_ORDINAL", base().slice(0, 2).concat([{ speaker: "host", kind: "new", text: "第三种方案具体展开讲一讲。" }]).concat(base().slice(2)), "悬空指代（第三种方案）");
expect("GUEST_NEVER_ASKS", [{ speaker: "host", kind: "new", text: H }, { speaker: "guest", kind: "new", text: G }].concat(Array.from({ length: 8 }, () => pair("那还有什么要注意的？", "注意匹配电压和功率。")).flat()).concat([{ speaker: "host", kind: "new", text: "OK，感谢DeepSeek。" }, { speaker: "guest", kind: "new", text: "不客气。总的来说：先换开关。" }, { speaker: "host", kind: "new", text: END }]), "嘉宾从不反问", "warn");
expect("HOST_ADDS_VIEW", base().slice(0, 2).concat([{ speaker: "host", kind: "new", text: "嗯，给例子确实比给规则管用。" }]).concat(base().slice(2)), "主持人自加判断");
expect("VIEW_MISATTRIBUTED", base().slice(0, 2).concat([{ speaker: "host", kind: "new", text: "最可能是驱动器内置了软启动保护。" }, { speaker: "guest", kind: "new", text: "是的。" }]).concat(base().slice(4)), "把嘉宾的观点安到主持人嘴里");
console.log("\n自检结果：" + ok + " 项通过，" + bad + " 项没触发");
process.exit(bad ? 1 : 0);