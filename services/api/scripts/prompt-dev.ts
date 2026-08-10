// 提示词调试工具（宿主运行）：改完 prompts.ts 一条命令验证输出质量。
// 不登录、不污染 DB、不走全链路——直接构造 messages → 发 DeepSeek → 打印 prompt + 原始输出 + 解析结果。
//
// 用法（services/api 下）：
//   pnpm prompt:dev                          ← 用 DB 最新快照的对话
//   pnpm prompt:dev --file /tmp/dlg.json     ← 自定义对话（[{role,content}] 或 [["用户","内容"],...]）
//   pnpm prompt:dev --instruction "开场更简洁"
//   pnpm prompt:dev --persona '{"callName":"小明","profession":"程序员","traits":"风趣幽默"}'
//   pnpm prompt:dev --safety --file /tmp/seg.json   ← 跑安全门 + 节目元数据（safetyMetaPrompt）
//   pnpm prompt:dev --raw                       ← 不解析，只看原始 LLM 输出
import { createLlmClient } from "../src/llm/client";
import { polishPrompt, safetyMetaPrompt, parseJsonLoose } from "../src/llm/prompts";
import { createDb } from "../src/db/client";
import type { Env } from "../src/config/env";

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };
  return {
    file: get("--file"),
    instruction: get("--instruction"),
    persona: get("--persona"),
    aiName: get("--ai"),
    aiIntro: get("--intro"),
    hostName: get("--host"),
    safety: argv.includes("--safety"),
    raw: argv.includes("--raw"),
    snapshot: argv.includes("--snapshot") || (!get("--file") && !argv.includes("--safety")),
  };
}

async function loadMessages(file?: string): Promise<{ role: string; content: string }[]> {
  if (file) {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    // 兼容两种输入：{role,content}[] 或 ["用户","内容"] 对数组
    if (Array.isArray(raw) && raw.every((m) => m && typeof m === "object" && "role" in m)) return raw;
    if (Array.isArray(raw) && raw.every((m) => Array.isArray(m) && m.length === 2)) {
      return raw.map(([role, content]) => ({ role: role === "用户" || role === "user" ? "user" : "assistant", content }));
    }
    throw new Error("无法识别的对话格式：需 [{role,content}] 或 [['用户','内容'],...]");
  }
  // 默认：DB 最新快照的对话（含平台/标题）
  const dbClient = createDb({ DATABASE_URL: process.env.DATABASE_URL! } as Env);
  const rows = await dbClient.client.unsafe<{ platform: string; source_title: string | null; parsed_dialogue: unknown }[]>(
    `SELECT platform, source_title, parsed_dialogue FROM snapshots WHERE parsed_dialogue IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
  );
  await dbClient.client.end();
  const row = rows[0];
  if (!row) throw new Error("DB 没有快照对话，用 --file 指定");
  console.log(`\n[对话来源] ${row.source_title ?? "未命名"}（${row.platform}）`);
  return (row.parsed_dialogue as { role: string; content: string }[]).slice(0, 40);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const llm = createLlmClient({
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-chat",
  });

  if (args.safety) {
    const messages = await loadMessages(args.file);
    const segments = messages.filter((m) => m.content && m.content.trim()).map((m) => ({ speaker: m.role === "user" ? "host" : "guest", text: m.content }));
    const prompt = safetyMetaPrompt(segments);
    console.log("════════ 安全门 + 元数据 prompt ════════");
    console.log(prompt[0].content.slice(0, 1200));
    const out = await llm.complete(prompt);
    console.log("\n════════ LLM 输出 ════════");
    console.log(out);
    console.log("\n════════ 解析 ════════");
    console.log(JSON.stringify(parseJsonLoose(out), null, 2));
    return;
  }

  const messages = await loadMessages(args.file);
  let persona: Record<string, unknown> | undefined;
  if (args.persona) {
    try {
      persona = JSON.parse(args.persona);
    } catch {
      throw new Error("--persona 需是 JSON 字符串");
    }
  }
  // 与 transcripts/new 相同的拼装逻辑（事实 + 性格）
  const callName = typeof persona?.callName === "string" ? persona.callName.trim() : args.hostName?.trim() ?? null;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const personaText = [callName, str(persona?.gender, 10), str(persona?.profession, 30), str(persona?.age, 10), str(persona?.traits, 100)]
    .some(Boolean)
    ? [callName ? `称呼：${callName}` : null, str(persona?.gender, 10) ? `性别：${str(persona?.gender, 10)}` : null,
       str(persona?.profession, 30) ? `职业：${str(persona?.profession, 30)}` : null,
       str(persona?.age, 10) ? `年龄：${str(persona?.age, 10)}` : null,
       str(persona?.traits, 100) ? `性格：${str(persona?.traits, 100)}` : null]
      .filter(Boolean).join("；")
    : "";

  const prompt = polishPrompt(messages, args.instruction, {
    hostName: callName,
    aiName: args.aiName?.trim() ?? "AI 嘉宾",
    aiIntro: args.aiIntro?.trim() ?? null,
    hostPersona: personaText || null,
  });

  console.log("════════ 对话轮数 ════════");
  console.log(`${messages.length} 条（${messages.filter((m) => m.role === "user").length} 轮用户）`);
  console.log("\n════════ SYSTEM PROMPT（全文）════════");
  console.log(prompt[0].content);
  console.log("\n════════ USER PROMPT（前 600 字）════════");
  console.log(prompt[1].content.slice(0, 600) + (prompt[1].content.length > 600 ? "\n…" : ""));

  console.log("\n════════ LLM 流式输出 ════════");
  let full = "";
  await llm.stream(prompt, (d) => {
    full += d;
    process.stdout.write(d);
  });
  console.log("\n\n════════ 解析 ════════");
  if (args.raw) {
    console.log(full.slice(0, 2000));
    return;
  }
  const parsed = parseJsonLoose(full) as
    | { language?: unknown; scripts?: unknown; quality_failed?: unknown; reason?: unknown }
    | { language?: unknown; segments?: unknown }
    | unknown[] | null;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { quality_failed?: unknown }).quality_failed) {
    console.log(`⚠️ 质量不合格：${(parsed as { reason?: unknown }).reason ?? ""}`);
    return;
  }
  const scripts = Array.isArray(parsed)
    ? [{ topic: null, segments: parsed }]
    : Array.isArray((parsed as { scripts?: unknown }).scripts)
      ? (parsed as { scripts: { topic?: unknown; segments?: unknown }[] }).scripts
      : Array.isArray((parsed as { segments?: unknown }).segments)
        ? [{ topic: null, segments: (parsed as { segments?: unknown }).segments }]
        : null;
  if (!scripts) {
    console.log("❌ 解析失败（输出不是合法 JSON 结构），原始输出见上");
    return;
  }
  for (const [i, s] of scripts.entries()) {
    const segs = Array.isArray(s.segments) ? s.segments : [];
    console.log(`\n脚本 #${i + 1}${s.topic ? ` · ${String(s.topic)}` : ""}：${segs.length} 段 / 约 ${segs.reduce((n: number, x: { text?: unknown }) => n + (typeof x?.text === "string" ? x.text.length : 0), 0)} 字`);
    if (!args.raw) {
      for (const seg of segs as { speaker?: unknown; text?: unknown }[]) {
        console.log(`  [${seg.speaker === "host" ? "主持人" : "AI"}] ${typeof seg.text === "string" ? seg.text.slice(0, 80) : ""}${typeof seg.text === "string" && seg.text.length > 80 ? "…" : ""}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
