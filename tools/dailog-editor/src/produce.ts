// 制作流水线（用户从脚本清单选号后触发）：tts → merge → cover 机器串联
//   pnpm editor produce --ids <submissionId,...> [--language zh] [--guest <platform>]
//   → 逐个：找草稿 script.json → 逐段 TTS（服务端）→ ffmpeg 合成（intro/outro 自动匹配）
//     → 封面（脚本 coverKeywords；无则跳过提示）
//   → 输出：每条 final.mp3 路径 + 节目信息草稿（title）
//   → 人工确认点：① 试听 final.mp3（语音预览确认）② 节目信息呈现 → 确认后 publish
//   publish 完成：投稿状态 → published + 站内通知 + 邮件（服务端 publish 端点已实现）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { draftDir } from "./lib.js";
import { tts } from "./tts.js";
import { merge } from "./merge.js";
import { cover } from "./cover.js";

function parseArgs(args: string[]): { ids: string[]; language: string; guest: string | null } {
  const idsIdx = args.indexOf("--ids");
  const langIdx = args.indexOf("--language");
  const guestIdx = args.indexOf("--guest");
  const ids = idsIdx >= 0 && args[idsIdx + 1] ? args[idsIdx + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  if (ids.length === 0) {
    console.error("用法：pnpm editor produce --ids <submissionId,...> [--language zh] [--guest <platform>]");
    process.exit(1);
  }
  return {
    ids,
    language: langIdx >= 0 && args[langIdx + 1] ? args[langIdx + 1].toLowerCase() : "zh",
    guest: guestIdx >= 0 && args[guestIdx + 1] ? args[guestIdx + 1].toLowerCase() : null,
  };
}

/** 找草稿 script*.json；返回路径或 null */
function findScript(submissionId: string): string | null {
  const dir = draftDir(submissionId);
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => /^script.*\.json$/.test(x));
  return f ? join(dir, f) : null;
}

/** 从脚本 JSON 提取节目信息（title/coverKeywords——脚本生成时若带元数据） */
function scriptMeta(scriptPath: string): { title: string | null; coverKeywords: string | null } {
  try {
    const raw = JSON.parse(readFileSync(scriptPath, "utf-8")) as {
      title?: string;
      coverKeywords?: string[];
      segments?: Array<{ speaker: string; text: string }>;
    };
    if (Array.isArray(raw)) return { title: null, coverKeywords: null };
    return {
      title: raw.title ?? null,
      coverKeywords: Array.isArray(raw.coverKeywords) && raw.coverKeywords.length > 0 ? raw.coverKeywords[0] : null,
    };
  } catch {
    return { title: null, coverKeywords: null };
  }
}

export async function produce(config: EditorConfig, args: string[]): Promise<void> {
  const { ids, language, guest } = parseArgs(args);
  console.log(`[produce] 制作流水线：${ids.length} 条（语言 ${language}${guest ? ` / 嘉宾 ${guest}` : ""}）…\n`);

  const results: Array<{ id: string; ok: boolean; finalPath?: string; title: string | null; error?: string }> = [];
  for (const id of ids) {
    process.stdout.write(`[produce] ${id.slice(0, 8)}… `);
    const scriptPath = findScript(id);
    if (!scriptPath) {
      console.log("⚠️ 无脚本（先跑 batch-scripts 确认脚本已生成）");
      results.push({ id, ok: false, title: null, error: "无脚本" });
      continue;
    }
    const meta = scriptMeta(scriptPath);
    try {
      // ① TTS（逐段合成，服务端端点）
      await tts(config, [id, "--script", scriptPath, "--language", language, ...(guest ? ["--guest", guest] : [])]);
      // ② 合成（intro/outro 按语言自动匹配）
      await merge(config, [id, "--language", language]);
      // ③ 封面（脚本 coverKeywords；无则跳过提示）
      if (meta.coverKeywords) {
        await cover(config, [id, meta.coverKeywords]);
      } else {
        console.log("[produce] 封面：脚本无 coverKeywords——跳过（可手动 pnpm editor cover）");
      }
      const finalPath = join(draftDir(id), "final.mp3");
      results.push({ id, ok: true, finalPath, title: meta.title });
      console.log(`[produce] ${id.slice(0, 8)}… ✅ 完成（final.mp3 + ${meta.coverKeywords ? "封面" : "无封面"}）\n`);
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`);
      results.push({ id, ok: false, title: meta.title, error: (e as Error).message });
    }
  }

  // 汇总 + 两个人工确认点
  console.log("========== produce 结果 ==========");
  for (const r of results) {
    if (r.ok) {
      console.log(`✅ ${r.id}${r.title ? `《${r.title}》` : ""} → ${r.finalPath}`);
    } else {
      console.log(`❌ ${r.id} — ${r.error}`);
    }
  }
  console.log("\n确认点 ① 语音预览：open <final.mp3> 试听（音色/断句/情绪标签）——确认后进入发布确认");
  console.log("确认点 ② 节目信息：确认标题/简介/标签/封面 → publish（状态 published + 通知 + 邮件）");
  console.log("命令：pnpm editor publish <id> --title \"...\" [--cover <path>] [--tags a,b] [--guest <platform>]");
}
