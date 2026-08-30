// 已发布节目清单（编辑端：定位要重新生成的节目）
//   pnpm editor episodes                      全部已发布节目（按期号倒序）
//   pnpm editor episodes --match "关键词"      按标题/期号过滤
import type { EditorConfig } from "./lib.js";
import { api, durationLabel } from "./lib.js";

interface PublishedEpisodeRow {
  id: string;
  slug: string;
  title: string | null;
  number: number | null;
  status: string;
  isPublic: boolean;
  isPicked: boolean;
  tags: string[] | null;
  durationSeconds: number | null;
  publishedAt: string | null;
}

function parseArgs(args: string[]): { match: string | null } {
  const idx = args.indexOf("--match");
  return { match: idx >= 0 && args[idx + 1] ? args[idx + 1] : null };
}

export async function episodes(config: EditorConfig, args: string[]): Promise<void> {
  const { match } = parseArgs(args);
  const rows = (await api(config, "/v1/editor/episodes")) as PublishedEpisodeRow[];
  if (rows.length === 0) {
    console.log("[episodes] 暂无已发布节目");
    return;
  }
  let filtered = rows;
  if (match) {
    const q = match.toLowerCase();
    filtered = rows.filter((r) =>
      (r.title ?? "").toLowerCase().includes(q) ||
      (r.number !== null && String(r.number) === q) ||
      (r.tags ?? []).some((t) => t.toLowerCase().includes(q)),
    );
    if (filtered.length === 0) {
      console.log(`[episodes] 无匹配「${match}」的节目（共 ${rows.length} 期）`);
      return;
    }
  }
  const site = (config.siteUrl ?? "").replace(/\/$/, "");
  console.log(`[episodes] 已发布节目（${filtered.length}/${rows.length}）:`);
  for (const r of filtered) {
    const state = r.isPublic === false ? "已下架" : "已发布";
    const pick = r.isPicked ? " ⭐ 精选" : "";
    const dur = r.durationSeconds != null ? ` · ${durationLabel(r.durationSeconds)}` : "";
    const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
    const date = r.publishedAt ? r.publishedAt.slice(0, 10) : "?";
    console.log(`  #${r.number ?? "?"}  ${r.title ?? "(无标题)"}${pick}`);
    console.log(`      状态: ${state} · ${date}${dur}`);
    console.log(`      链接: ${site}/episode/${r.slug}`);
    console.log(`      id: ${r.id}`);
  }
  console.log("\n提示：重新生成某期 → pnpm editor detail <submissionId> 找到该投稿，重跑 三步制作 → tts → merge → cover → republish");
}