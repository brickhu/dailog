// ffmpeg 合成：点题 → 片头 → 对谈 → 落点+收束 → outro → final.m4a（分段模式）
//   · 分段模式（part1/2/3.mp3，tts --parts 产物）：片头插在点题（part1）与对谈（part2）之间；
//     无分段（full.mp3）兜底：intro + full + outro（片头在开头）
//   · intro/outro **统一自动匹配语言**（--language，默认 zh）：assets/intro.{lang}.mp3
//     语言专属缺失 → fallback 通用 intro.mp3；都缺失 → 警告跳过（不阻塞发布）
//   · --intro/--outro 可显式指定本地文件（临时替换默认资产）
//   · 段之间留 0.6s 静音间隔（ffmpeg concat demuxer 用 silence 占位——文案自然停顿）
// 输出：drafts/{submissionId}/final.m4a + duration（ffprobe）
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { EditorConfig } from "./lib.js";
import { defaultAssetsDir, draftDir, durationLabel, writeProgress } from "./lib.js";

function parseArgs(args: string[]): { submissionId: string; language: string; intro?: string; outro?: string } {
  const submissionId = args[0];
  if (!submissionId) {
    console.error("用法：pnpm editor merge <submissionId> [--language zh|en] [--intro f.mp3] [--outro f.mp3]");
    process.exit(1);
  }
  const take = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  const language = take("--language") ?? "zh";
  if (!/^[a-z]{2,3}$/i.test(language)) {
    console.error(`[merge] 非法语言：${language}（如 zh/en）`);
    process.exit(1);
  }
  return { submissionId, language: language.toLowerCase(), intro: take("--intro"), outro: take("--outro") };
}

/** 按语言解析资产：{assets}/{kind}.{lang}.mp3 → fallback {kind}.mp3；都无 → null */
function resolveAsset(config: EditorConfig, kind: "intro" | "outro", language: string): string | null {
  const base = defaultAssetsDir();
  const candidates = [join(base, `${kind}.${language}.mp3`), join(base, `${kind}.mp3`)];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf-8" });
  return Number(out.trim());
}

export async function merge(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, language, intro, outro } = parseArgs(args);
  const dir = draftDir(submissionId);
  const fullPath = join(dir, "full.mp3");
  const segmentsFile = join(dir, "segments.json");
  if (!existsSync(fullPath) && !existsSync(segmentsFile)) {
    console.error(`[merge] 缺少 ${fullPath}（整集）或 ${segmentsFile}（逐段）——先运行 pnpm editor tts ${submissionId}`);
    process.exit(1);
  }

  // intro/outro：显式 --intro/--outro 优先；否则按语言自动匹配（语言专属缺失 → 通用资产）
  const introPath = intro && existsSync(intro) ? intro : resolveAsset(config, "intro", language);
  const outroPath = outro && existsSync(outro) ? outro : resolveAsset(config, "outro", language);
  if (introPath) {
    console.log(`[merge] intro：${introPath.replace(process.cwd() + "/", "")} ✅`);
  } else {
    console.warn(`[merge] intro 资产缺失（${language} 专属与通用均无）——已跳过（可放 ${defaultAssetsDir()}/intro.mp3）`);
  }
  if (outroPath) {
    console.log(`[merge] outro：${outroPath.replace(process.cwd() + "/", "")} ✅`);
  } else {
    console.warn(`[merge] outro 资产缺失（${language} 专属与通用均无）——已跳过`);
  }

  // 拼接清单：
  //   · 分段模式（part1/2/3.mp3）——新结构：点题(part1) → 片头 → 对谈(part2) → 落点+收束(part3) → outro
  //   · 整集模式（full.mp3）——兜底：intro + full + outro（无分段时片头只能在开头）
  //   · 旧逐段模式（segments.json）——兼容
  const parts: string[] = [];
  const silence = join(dir, "_silence.mp3");
  const ensureSilence = (): string | null => {
    if (existsSync(silence)) return silence;
    try {
      execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "0.6", "-q:a", "9", silence], { stdio: "ignore" });
      return silence;
    } catch {
      console.warn("[merge] 静音段生成失败（继续拼接）");
      return null;
    }
  };
  // 项之间插 0.6s 静音（首尾不加）
  const withGap = (items: string[]): string[] => {
    const out: string[] = [];
    items.forEach((it, i) => {
      out.push(it);
      if (i < items.length - 1) {
        const s = ensureSilence();
        if (s) out.push(s);
      }
    });
    return out;
  };

  const p1 = join(dir, "part1.mp3");
  const p2 = join(dir, "part2.mp3");
  const p3 = join(dir, "part3.mp3");
  if (existsSync(p1) && existsSync(p2) && existsSync(p3)) {
    // 新结构：点题 → 片头 → 对谈 → 落点+收束 → outro（片头插在点题与对谈之间）
    const items: string[] = [p1];
    if (introPath) items.push(introPath);
    items.push(p2, p3);
    if (outroPath) items.push(outroPath);
    parts.push(...withGap(items));
    console.log(`[merge] 分段模式：点题 → ${introPath ? "片头" : "（无片头）"} → 对谈 → 落点+收束${outroPath ? " → outro" : ""}`);
  } else if (existsSync(fullPath)) {
    const items: string[] = [];
    if (introPath) items.push(introPath);
    items.push(fullPath);
    if (outroPath) items.push(outroPath);
    parts.push(...withGap(items));
    console.log("[merge] 整集模式（无分段）：intro + full + outro（片头在开头）");
  } else {
    const index = JSON.parse(readFileSync(segmentsFile, "utf-8")) as Array<{ file: string }>;
    const items: string[] = [];
    if (introPath) items.push(introPath);
    for (const seg of index) items.push(join(dir, seg.file));
    if (outroPath) items.push(outroPath);
    parts.push(...withGap(items));
    console.log("[merge] 逐段模式（segments.json）");
  }

  const listFile = join(dir, "_concat.txt");
  writeFileSync(listFile, parts.map((p) => `file '${p}'`).join("\n"));
  // AAC 80k（Apple 播客推荐格式；比 MP3 96k 再省 30%）——成品统一 final.m4a
  const finalPath = join(dir, "final.m4a");
  console.log(`[merge] 拼接 ${parts.length} 个音频…`);
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:a", "aac", "-b:a", "80k", finalPath], { stdio: "ignore" });

  const duration = ffprobeDuration(finalPath);
  writeProgress(submissionId, "merged");
  const size = statSync(finalPath).size;
  console.log(`[merge] 完成 → ${finalPath}（${durationLabel(duration)}，${(size / 1024 / 1024).toFixed(1)}MB）`);
  console.log(`[merge] 发布：pnpm editor publish ${submissionId} --audio ${finalPath} --title "..." --language ${language}`);

  // 合成完成自动打开试听（QuickTime Player，macOS）：发布前必须试听——音色/断句/情绪标签
  try {
    const app = process.platform === "darwin" ? "-a QuickTime Player" : "";
    execFileSync("open", app ? ["-a", "QuickTime Player", finalPath] : [finalPath], { stdio: "ignore" });
    console.log("[merge] ▶️ 已在 QuickTime Player 打开 " + ${finalPath} + " 试听——像不像两个人在聊？四问：①找得到几处'对方存在'的证据 ②有没有整段像念稿 ③情绪是跟着话走还是像在演 ④有没有至少一处不完美的真实");
  } catch {
    console.log(`[merge] 试听：open ${finalPath}（自动打开失败，请手动打开）`);
  }
}
