#!/usr/bin/env node
// 提示词字典审计（工程检查，CI 可挂）：对 prompts.json 每个条目校验
//   ① {{占位符}} 根键 ⊆ params 白名单（构建期指针，代码解析，错则抛）
//   ② <锚点> ⊆ user/assistant 消息标签（运行期指针，模型解析，靠命名一致校验）
//   ③ 代码块外残留单花括号点路径 {a.b} 报告（信息级，预期为空）
// 约定：锚点 <XXX> 必须与消息模板里的标签行 "XXX：" 逐字同名（标签是静态文本，保证可校验）
import { getPrompt, listPrompts } from "../lib/prompt.mjs";

const errors = [];
const warns = [];

/** 剥离 ``` 围栏代码块（输出 JSON 示例里的 <Number> / {dialogue.sourceUrl} 是 schema 占位符，不参与校验） */
function stripFences(s) {
  return s.replace(/```[\s\S]*?```/g, "");
}

for (const key of listPrompts()) {
  const p = getPrompt(key);
  const allowed = new Set(Object.keys(p.params || {}));
  const sys = p.messages.filter(m => m.role === "system");
  const targets = p.messages.filter(m => m.role === "user" || m.role === "assistant");

  // ① 占位符白名单
  for (const m of p.messages) {
    for (const h of [...m.content.matchAll(/\{\{([\w.]+)\}\}/g)].map(x => x[1])) {
      const root = h.split(".")[0];
      if (!allowed.has(root)) errors.push(`${key} [${m.role}] 占位符 {{${h}}} 未在 params 声明`);
    }
  }

  // ② 数据锚点 ⊆ 标签：仅校验"输入"段落（标题含"输入"的行起，到下一个标题止）里的 <XXX>
  //    ——输入段落里的 <XXX> 是数据锚点，必须能在消息里找到 "XXX：" 标签行；
  //    ——正文其他位置的 <XXX>（如 <工作流>/<输出契约>）视为文档内自由引用，不参与校验
  const labels = new Set();
  for (const m of p.messages) {
    for (const lm of stripFences(m.content).matchAll(/^[ \t]*([^：\n]+)：/gm)) labels.add(lm[1].trim());
  }
  for (const m of p.messages) {
    const lines = stripFences(m.content).split("\n");
    let inInput = false;
    for (const line of lines) {
      if (/^#{1,6}\s*/.test(line)) inInput = /输入/.test(line);   // 进入/离开含"输入"的标题段落
      if (!inInput) continue;
      for (const am of line.matchAll(/<([\u4e00-\u9fff0-9（）()]+)>/g)) {
        const anchor = am[1].trim();
        if (!labels.has(anchor)) {
          errors.push(`${key} [${m.role}] 数据锚点 <${anchor}> 无同名标签（现有标签：${[...labels].join("、") || "无"}）`);
        }
      }
    }
  }

  // ③ 代码块外残留单花括号点路径（信息级）
  for (const m of p.messages) {
    for (const mm of stripFences(m.content).matchAll(/(?<!\{)\{(?!\{)([a-zA-Z][\w]*\.[a-zA-Z][\w.]*)\}/g)) {
      warns.push(`${key} [${m.role}] 单花括号点路径 {${mm[1]}}`);
    }
  }
}

console.log("== 提示词字典审计 ==");
console.log("检查条目:", listPrompts().join(", "));
console.log("\n① 占位符白名单:", errors.filter(e => e.includes("占位符")).length ? "有错误↓" : "PASS");
console.log("② 锚点↔标签一致:", errors.filter(e => e.includes("锚点")).length ? "有错误↓" : "PASS");
if (errors.length) {
  console.log("\nERRORS:");
  for (const e of errors) console.log("  ✗ " + e);
}
if (warns.length) {
  console.log("\nWARN（预期为空；出现即检查是否漏改）:");
  for (const w of warns) console.log("  ⚠ " + w);
} else {
  console.log("\n③ 代码块外单花括号残留: 无");
}
console.log(errors.length ? "\n✗ 审计失败" : "\n✓ 审计通过");
process.exit(errors.length ? 1 : 0);
