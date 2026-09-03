import { getPrompt, renderPrompt } from "./lib/prompt.mjs";
const pScript = getPrompt("review.script");
const msgs = renderPrompt(pScript, { score: 7.3, selection: { main_topic: "挂谷猜想", category: "insight", advice: "用线段旋转的最小面积做开场钩子" }, suggestion: "s", host: { callName: "飞" }, guests: [{ name: "KAI" }] });
console.log("结构:", msgs.map(m => m.role).join(" + "));
const h = msgs[0].content, u = msgs[1].content;
let fail = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else console.log("PASS:", m); };
a(msgs.length === 2 && msgs[0].role === "assistant", "handoff 是 assistant");
// 完整性抽查（规则关键点都在）
for (const k of ["# 1. 角色", "# 2.创作原则", "不编造（红线", "# 3. 写作结构", "7.1 点题", "7.3 落点与收束", "# 4. 脚本输出规范", "creationNote", "# 5. 穿插设计", "# 6. 听感与语域", "# 7. 不好的脚本", "书面腔", "{{host.callName}}", "{{guests.name}}"]) {
  a(h.includes(k), "handoff 含「" + k.slice(0, 18) + "…」");
}
a(!h.includes("评分={{score}}"), "handoff 不再含动态评分占位");
a(!h.includes("selection"), "handoff 不再引用 selection");
a(!h.includes("8. 重生成"), "已删除重生成模式");
a(u.includes("评分={{score}}") || u.includes("{{score}}"), "动态内容在 user");
a(u.includes("主线话题：{{selection.main_topic}}") && u.includes("{{selection.advice}}"), "user 含动态主线+advice");
a(u.includes("5-10 分钟"), "user 含时长");
a(u.includes("{{host}}") && u.includes("{{guests}}") && u.includes("{{suggestion}}"), "user 含数据占位");
console.log("\n=== user 消息 ===");
console.log(u);
process.exit(fail ? 1 : 0);
