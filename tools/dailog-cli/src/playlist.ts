// 播放列表管理（平台策展，0032）：列表/创建/详情/增删节目/重排/精选/公开/删除/封面
//   pnpm editor playlist list
//   pnpm editor playlist create "<title>" [--desc "..."] [--language zh|en] [--picked] [--private]
//   pnpm editor playlist lang <playlistId> <zh|en>
//   pnpm editor playlist episodes <playlistId>
//   pnpm editor playlist add <playlistId> <episodeId|#期号>
//   pnpm editor playlist remove <playlistId> <episodeId>
//   pnpm editor playlist reorder <playlistId> <episodeId1,episodeId2,...>
//   pnpm editor playlist pick <playlistId> | unpick <playlistId>
//   pnpm editor playlist public <playlistId> | private <playlistId>
//   pnpm editor playlist delete <playlistId>
//   pnpm editor playlist cover <playlistId> [--texture ...] [--colors "#hex,#hex"] [--image-url <url>]
import type { EditorConfig } from "./lib.js";
import { api } from "./lib.js";
import { renderCoverImage } from "./cover.js";

interface EditorPlaylist {
  id: string; slug: string; kind: string; ownerId: string | null;
  title: string; description: string | null; coverUrl: string | null;
  language: string; isPublic: boolean; isPicked: boolean;
  createdAt: string; updatedAt: string;
  episodeCount: number; firstCover: string | null; firstEpisodeId: string | null;
}

interface EditorEpisode { id: string; number: number | null; title: string | null; }
interface PlaylistEpisodeRow {
  position: number; episodeId: string; slug: string; title: string | null;
  durationSeconds: number | null; username: string; displayName: string;
}

function usage(): never {
  console.error("用法：pnpm editor playlist <list|create|episodes|add|remove|reorder|pick|unpick|public|private|delete|cover> [args]");
  process.exit(1);
}

async function plList(config: EditorConfig): Promise<void> {
  const list = (await api(config, "/v1/editor/playlists")) as EditorPlaylist[];
  if (list.length === 0) { console.log("[playlist] 暂无播放列表——playlist create 创建"); return; }
  console.log(`[playlist] 平台列表（${list.length}）：`);
  for (const p of list) {
    const flags = [p.isPicked ? "精选" : "", !p.isPublic ? "私有" : ""].filter(Boolean).join("·");
    console.log(`  ${p.id.slice(0, 8)}  ${p.title}${p.description ? ` — ${p.description.slice(0, 40)}` : ""}`);
    console.log(`         ${p.episodeCount} 期${flags ? ` · ${flags}` : ""} · /playlist/${p.slug}`);
  }
  console.log("\n管理：playlist episodes <id> · add/remove · reorder · pick/unpick · public/private · cover <id> · delete");
}

async function plCreate(config: EditorConfig, args: string[], take: (f: string) => string | undefined): Promise<void> {
  const title = args[0]?.trim();
  if (!title) { console.error("用法：pnpm editor playlist create \"<标题>\" [--desc \"...\"] [--language zh|en] [--picked] [--private]"); process.exit(1); }
  const langRaw = take("--language") ?? "zh";
  const language = langRaw === "en" ? "en" : langRaw === "zh" ? "zh" : (() => { console.error("[playlist] --language 仅支持 zh|en"); process.exit(1); })();
  const created = (await api(config, "/v1/editor/playlists", {
    method: "POST",
    body: {
      title,
      description: take("--desc") ?? null,
      language,
      isPublic: !args.includes("--private"),
      isPicked: args.includes("--picked"),
    },
  })) as { id: string; slug: string };
  console.log(`[playlist] ✅ 已创建「${title}」（${language}） id=${created.id} slug=${created.slug}`);
  console.log(`[playlist]   公开页：/playlist/${created.slug} · 加节目：playlist add ${created.id} <episodeId|#期号>`);
}

async function plEpisodes(config: EditorConfig, playlistId: string): Promise<void> {
  if (!playlistId) usage();
  const detail = (await api(config, `/v1/editor/playlists/${playlistId}`)) as { title: string; episodes: PlaylistEpisodeRow[] };
  console.log(`[playlist] 「${detail.title}」节目（${detail.episodes.length}）：`);
  for (const e of detail.episodes) {
    const host = e.displayName || e.username;
    const dur = e.durationSeconds ? ` · ${Math.floor(e.durationSeconds / 60)}min` : "";
    console.log(`  #${e.position + 1}  ${e.title ?? "（未命名）"}${dur} · ${host}`);
    console.log(`      id=${e.episodeId}  /episode/${e.slug}`);
  }
}

/** 期号引用（#N）→ 节目 id：从编辑端节目清单匹配 */
async function resolveEpisode(config: EditorConfig, ref: string): Promise<string> {
  const m = ref.match(/^#(\d+)$/);
  if (!m) return ref; // 直接当 id 用
  const number = Number(m[1]);
  const episodes = (await api(config, "/v1/editor/episodes")) as EditorEpisode[];
  const hit = episodes.find((e) => e.number === number);
  if (!hit) { console.error(`[playlist] 期号 #${number} 不存在（当前已发布 ${episodes.length} 期）`); process.exit(1); }
  return hit.id;
}

async function plAdd(config: EditorConfig, playlistId: string, ref: string): Promise<void> {
  if (!playlistId || !ref) usage();
  const episodeId = await resolveEpisode(config, ref);
  const r = (await api(config, `/v1/editor/playlists/${playlistId}/episodes`, {
    method: "POST", body: { episodeId },
  })) as { added: boolean };
  console.log(`[playlist] ${r.added ? "✅ 已加入" : "ℹ️ 已在列表中"}（${episodeId}）`);
}

async function plRemove(config: EditorConfig, playlistId: string, episodeId: string): Promise<void> {
  if (!playlistId || !episodeId) usage();
  await api(config, `/v1/editor/playlists/${playlistId}/episodes/${episodeId}`, { method: "DELETE" });
  console.log(`[playlist] ✅ 已移除（${episodeId}）`);
}

async function plReorder(config: EditorConfig, playlistId: string, csv: string): Promise<void> {
  if (!playlistId || !csv) usage();
  const episodeIds = csv.split(",").map((s) => s.trim()).filter(Boolean);
  if (episodeIds.length === 0) usage();
  await api(config, `/v1/editor/playlists/${playlistId}/episodes/reorder`, { method: "PUT", body: { episodeIds } });
  console.log(`[playlist] ✅ 已重排（${episodeIds.length} 条）`);
}

async function plSet(config: EditorConfig, playlistId: string, patch: Record<string, boolean>): Promise<void> {
  if (!playlistId) usage();
  await api(config, `/v1/editor/playlists/${playlistId}`, { method: "PATCH", body: patch });
  console.log(`[playlist] ✅ ${Object.keys(patch)[0]} = ${Object.values(patch)[0]}`);
}

/** 列表语言标记（zh/en）——中文列表进中文区、英文列表进英文区（站点按界面语言偏好分流） */
async function plLang(config: EditorConfig, playlistId: string, lang: string): Promise<void> {
  if (!playlistId || !lang) usage();
  if (lang !== "zh" && lang !== "en") { console.error("[playlist] lang 仅支持 zh|en"); process.exit(1); }
  await api(config, `/v1/editor/playlists/${playlistId}`, { method: "PATCH", body: { language: lang } });
  console.log(`[playlist] ✅ 列表语言已设为 ${lang}（${lang === "zh" ? "中文区优先" : "英文区优先"}）`);
}

async function plDelete(config: EditorConfig, playlistId: string): Promise<void> {
  if (!playlistId) usage();
  await api(config, `/v1/editor/playlists/${playlistId}`, { method: "DELETE" });
  console.log(`[playlist] ✅ 已删除（${playlistId}）`);
}

async function plCover(config: EditorConfig, args: string[], take: (f: string) => string | undefined): Promise<void> {
  const playlistId = args[0];
  if (!playlistId) { console.error("用法：pnpm editor playlist cover <playlistId> [--texture ...] [--colors \"#hex,#hex\"] [--image-url <url>]"); process.exit(1); }
  const texture = take("--texture");
  const colorsRaw = take("--colors");
  const colors = colorsRaw ? (colorsRaw.split(",").map((s) => s.trim()).filter(Boolean) as [string, string]) : null;
  const imageUrl = take("--image-url") ?? null;
  console.log("[playlist] 生成列表封面…");
  const { bytes, meta } = await renderCoverImage({ seed: playlistId, texture, colors, imageUrl });
  const form = new FormData();
  // new Uint8Array(bytes) 复制出独立 ArrayBuffer——BlobPart 要求 Uint8Array<ArrayBuffer>（TS 泛型约束）
  form.append("cover", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), "cover.jpg");
  const r = (await api(config, `/v1/editor/playlists/${playlistId}/cover`, { method: "POST", formData: form })) as { coverUrl: string };
  console.log(`[playlist] ✅ 封面上传成功 → ${r.coverUrl}`);
  if (!meta.fromImage) {
    console.log(`[playlist]   固定复现：playlist cover ${playlistId} --texture ${meta.textureName} --colors "${meta.base},${meta.textureColor}"`);
  }
}

export async function playlist(config: EditorConfig, args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const take = (flag: string) => { const i = rest.indexOf(flag); return i >= 0 && rest[i + 1] ? rest[i + 1] : undefined; };
  switch (sub) {
    case "list": return plList(config);
    case "create": return plCreate(config, rest, take);
    case "episodes": return plEpisodes(config, rest[0]);
    case "add": return plAdd(config, rest[0], rest[1]);
    case "remove": return plRemove(config, rest[0], rest[1]);
    case "reorder": return plReorder(config, rest[0], rest[1]);
    case "pick": return plSet(config, rest[0], { isPicked: true });
    case "unpick": return plSet(config, rest[0], { isPicked: false });
    case "public": return plSet(config, rest[0], { isPublic: true });
    case "private": return plSet(config, rest[0], { isPublic: false });
    case "lang": return plLang(config, rest[0], rest[1]);
    case "delete": return plDelete(config, rest[0]);
    case "cover": return plCover(config, rest, take);
    default: return usage();
  }
}
