import { readFileSync, writeFileSync } from "fs";
const user = readFileSync("prompts/review.script.user.md", "utf8");
const handoff = readFileSync("prompts/review.script.handoff.md", "utf8");

// 从 user.md 抽取规则正文（# 1. 角色 起到 "# 数据" 之前）
const dataIdx = user.indexOf("# 数据");
const rulesPart = user.slice(user.indexOf("# 1. 角色"), dataIdx).trimEnd() + "
";

// 新 handoff = 交接开头 + 数据位置说明 + 全部规则正文
const header = handoff.trimEnd() + "

输入数据位置：第1轮评分 / 主持人 / 嘉宾 / 投稿建议位于下一条 user 消息；对话全文已在前序消息完整提供（唯一事实来源）。

**以下是本轮的创作规则（输出契约与创作原则，严格遵守）：**

";
writeFileSync("prompts/review.script.handoff.md", header + rulesPart);

// 新 user = 纯数据
const slim = "# 数据
第1轮评分：{{score}}（已通过审核，直接基于该结论创作）

主持人：{{host}}
嘉宾：{{guests}}
投稿建议：{{suggestion}}
";
writeFileSync("prompts/review.script.user.md", slim);
console.log("handoff 行数:", (header + rulesPart).split("
").length, "| user 行数:", slim.split("
").length);
