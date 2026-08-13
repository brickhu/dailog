// Pexels 封面：关键词搜索 → 下载第一张（方形，≥1400px）到草稿目录
// 无 PEXELS_API_KEY 时提示（skill 可改用其他来源或留空封面）
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { draftDir, writeProgress } from "./lib.js";

function parseArgs(args: string[]): { submissionId: string; query: string; out?: string } {
  const submissionId = args[0];
  const query = args[1];
  const outIdx = args.indexOf("--out");
  if (!submissionId || !query) {
    console.error("用法：pnpm editor cover <submissionId> \"<关键词>\" [--out cover.jpg]");
    process.exit(1);
  }
  return { submissionId, query, out: outIdx >= 0 ? args[outIdx + 1] : undefined };
}

export async function cover(config: EditorConfig, args: string[]): Promise<void> {
  const { submissionId, query, out } = parseArgs(args);
  if (!config.pexelsApiKey) {
    console.error("[cover] .dailog-editor/.env 缺少 PEXELS_API_KEY（https://www.pexels.com/api 免费申请）");
    process.exit(1);
  }
  const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=square&size=large`, {
    headers: { Authorization: config.pexelsApiKey },
  });
  if (!res.ok) {
    console.error(`[cover] Pexels ${res.status}: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const data = (await res.json()) as { photos?: Array<{ src: { large2x?: string; large?: string } }> };
  const photo = data.photos?.[0];
  if (!photo) {
    console.error("[cover] 无搜索结果，换个关键词");
    process.exit(1);
  }
  const imgUrl = photo.src.large2x ?? photo.src.large;
  if (!imgUrl) {
    console.error("[cover] 搜索结果缺少图片地址，换个关键词");
    process.exit(1);
  }
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) {
    console.error(`[cover] 图片下载失败 ${imgRes.status}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await imgRes.arrayBuffer());
  const path = out ?? join(draftDir(submissionId), "cover.jpg");
  writeFileSync(path, bytes);
  console.log(`[cover] 已保存：${path}（${(bytes.length / 1024).toFixed(0)}KB）`);
  writeProgress(submissionId, "covered");
  console.log(`[cover] 发布时带上：pnpm editor publish ${submissionId} --cover ${path}`);
}
