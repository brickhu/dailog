// check-script：脚本机器校验（SC-GATE-2 附加信息）——pnpm editor check-script <submissionId>
// 读 drafts/<id>/script.json（新 parts / 旧 segments 兼容）+ dialogue.json，跑 checks.ts 全部断言。
// 输出：通过/警告/失败统计 + 明细；存在硬性失败（fail）时退出码 1（打回重跑 SC-STEP-2）。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { draftsDir, readScript } from "./lib.js";
import { CHECKS, type CheckResult } from "./checks.js";

function short(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

export async function checkScript(config: EditorConfig, args: string[]): Promise<void> {
  const id = args.find((a) => !a.startsWith("-"));
  if (!id) {
    console.error("[check-script] 需要 <submissionId>");
    process.exitCode = 1;
    return;
  }
  const scriptPath = join(draftsDir, id, "script.json");
  if (!existsSync(scriptPath)) {
    console.error(`[check-script] ${short(id)} 无终稿 script.json（先跑 SC-STEP-2）`);
    process.exitCode = 1;
    return;
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(scriptPath, "utf-8")) as Record<string, unknown>;
  } catch {
    console.error(`[check-script] ${short(id)} script.json 不是合法 JSON`);
    process.exitCode = 1;
    return;
  }
  // readScript 校验并摊平（非法段/空脚本会报错退出）
  let segments: ReturnType<typeof readScript>;
  try {
    segments = readScript(scriptPath);
  } catch {
    process.exitCode = 1;
    return;
  }
  let dialogue: { role: string; content: string }[] = [];
  const dialoguePath = join(draftsDir, id, "dialogue.json");
  if (existsSync(dialoguePath)) {
    try {
      const d = JSON.parse(readFileSync(dialoguePath, "utf-8")) as
        | { role: string; content: string }[]
        | { messages?: { role: string; content: string }[] };
      dialogue = Array.isArray(d) ? d : (d.messages ?? []);
    } catch {
      // dialogue 损坏 → 置空（host_question_trace 会注明跳过）
    }
  }

  const results: CheckResult[] = CHECKS.map((c) => {
    const r = c.run({ raw, segments, dialogue });
    return { id: c.id, name: c.name, level: c.level, ok: r.ok, detail: r.detail };
  });
  const fails = results.filter((r) => !r.ok && r.level === "fail");
  const warns = results.filter((r) => !r.ok && r.level === "warn");
  const passed = results.length - fails.length - warns.length;

  console.log(`**脚本校验**（${short(id)}）：通过 ${passed} · 警告 ${warns.length} · 失败 ${fails.length}`);
  for (const r of results) {
    if (r.ok) {
      console.log(`[✓] ${r.id} ${r.name}：${r.detail}`);
    } else if (r.level === "fail") {
      console.log(`[✗] ${r.id} ${r.name}：${r.detail}`);
    } else {
      console.log(`[!] ${r.id} ${r.name}：${r.detail}`);
    }
  }
  if (fails.length > 0) {
    console.log("→ 存在硬性失败，打回重跑 SC-STEP-2（见 SC-GATE-2）");
    process.exitCode = 1;
  } else if (warns.length > 0) {
    console.log("→ 警告项建议人工核对（不阻塞）");
  } else {
    console.log("→ 全部通过，可进 TTS");
  }
}
