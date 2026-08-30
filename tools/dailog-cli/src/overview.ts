// 工作台概要（overview 触发）：环境/网站/账号 + 采集·脚本·语音·节目 四管道待处理与共计 + 待处理选项
//   pnpm editor overview
//   → 输出「工作台概要」模板（SKILL docs/OV.md OV-GATE 固话模板）：
//      · ① 采集 待处理 = 服务端 submitted 队列；共计 = 投稿全量（submitted+rejected+published 三态求和）
//      · ② 脚本 待处理 = 本地草稿有 dialogue.json 无终稿 script.json；共计 = 已采集投稿全量
//      · ③ 语音 待处理 = 本地草稿有终稿 script.json 未合成 final.m4a；共计 = 脚本全量
//      · ④ 节目 待处理 = 本地草稿有 final.m4a 未发布（终态 published/rejected/republished 不计）；
//        共计 = 服务端已发布节目数
//      · 待处理选项 = 按流水线阶段（采集→脚本→语音→发布）生成的动作菜单（猜测下一步意图），
//        有积压的阶段才出现（如「批量采集 N 条投稿」「处理 N 条已采集未出脚本」）；无待处理不显示该块
//   → 未配对/端点不可达：计数显示 0，stderr 提示 login（OV-ERR）
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { tryApi, draftsDir, readProgress } from "./lib.js";

interface SubmissionRow {
  id: string;
  url: string;
  title: string | null;
  displayName: string;
}

interface EpisodeRow {
  id: string;
  number: number | null;
  title: string | null;
}

interface GuestRow {
  id: string;
  platform: string;
  name: string;
  avatar: string | null;
  intro: string | null;
  url: string | null;
}

interface VoiceSampleRow {
  guestId: string;
  guestName: string;
  language: string;
  audioKey: string;
  transcript: string | null;
}

interface EditorPlaylist {
  id: string;
  title: string;
  episodeCount: number;
}

interface RemovalRow {
  id: string;
}

/** 终态草稿（已发布/已拒/重发）不计入各管道待处理 */
const TERMINAL_STEPS = new Set(["published", "rejected", "republished"]);

export async function overview(config: EditorConfig, _args: string[]): Promise<void> {
  // 账号
  let email = "（未登录）";
  const profile = (await tryApi(config, "/v1/me/profile")) as { email?: string | null } | null;
  if (profile?.email) email = profile.email;

  // 投稿三态 → 全量；① 采集待处理 = submitted 队列
  const submitted = ((await tryApi(config, "/v1/editor/submissions")) as SubmissionRow[] | null) ?? [];
  const rejected = ((await tryApi(config, "/v1/editor/submissions?status=rejected")) as SubmissionRow[] | null) ?? [];
  const rejectedIds = new Set(rejected.map((r) => r.id));
  const publishedSubs = ((await tryApi(config, "/v1/editor/submissions?status=published")) as SubmissionRow[] | null) ?? [];
  const totalSubmissions = submitted.length + rejected.length + publishedSubs.length;

  // 已发布节目数（该环境共计发布 / ④ 共计）
  const episodes = ((await tryApi(config, "/v1/editor/episodes")) as EpisodeRow[] | null) ?? [];
  const totalEpisodes = episodes.length;

  // 其他功能概要：嘉宾（含声线就绪数）/ 播放列表（含总期数）/ 下线申请待审批
  const guestsList = ((await tryApi(config, "/v1/editor/guests")) as GuestRow[] | null) ?? [];
  const voiceSamples = ((await tryApi(config, "/v1/editor/guests/voice-samples")) as VoiceSampleRow[] | null) ?? [];
  const voiceReadyGuests = new Set(voiceSamples.map((s) => s.guestId)).size;
  const playlists = ((await tryApi(config, "/v1/editor/playlists")) as EditorPlaylist[] | null) ?? [];
  const playlistEpisodes = playlists.reduce((n, p) => n + (p.episodeCount ?? 0), 0);
  const removals = ((await tryApi(config, "/v1/editor/episodes/removal-requests")) as RemovalRow[] | null) ?? [];

  // 本地草稿四管道：共计含终态，待处理仅非终态
  let collectedAll = 0; // ② 共计 = 已采集投稿全量（有 dialogue.json）
  let scriptAll = 0;    // ③ 共计 = 脚本全量（有终稿 script.json）
  let scriptPending = 0;
  let voicePending = 0;
  let pubPending = 0;
  if (existsSync(draftsDir)) {
    for (const id of readdirSync(draftsDir)) {
      const dir = join(draftsDir, id);
      if (!existsSync(join(dir, "dialogue.json"))) continue;
      collectedAll++;
      const progress = readProgress(id);
      const terminal = (!!progress?.step && TERMINAL_STEPS.has(progress.step)) || rejectedIds.has(id); // 拒审不计待处理
      const hasScript = existsSync(join(dir, "script.json"));
      if (hasScript) scriptAll++;
      if (terminal) continue;
      if (!hasScript) scriptPending++;
      const hasFinal = existsSync(join(dir, "final.m4a"));
      if (hasScript && !hasFinal) voicePending++;
      if (hasFinal) pubPending++;
    }
  }

  console.log("**工作台概要**");
  console.log(`1. 环境：${config.envName ?? "default"} (${config.apiBase})`);
  console.log(`2. 网站：${config.siteUrl ?? "（未配置 siteUrl）"}`);
  console.log(`3. 账号：${email}`);
  console.log("");
  console.log(`该环境共计 ${totalSubmissions} 条投稿，共计发布 ${totalEpisodes} 条节目；`);
  console.log("___");
  console.log(`① 采集：**${submitted.length}** 条待处理，共计 ${totalSubmissions} 条；输入「采集」查看采集列表，「采集:{ID}」采集对话；`);
  console.log(`② 脚本：**${scriptPending}** 条待处理，共计 ${collectedAll} 条；输入「脚本」查看脚本列表，「脚本:{ID}」进入脚本审核和生成流程；`);
  console.log(`③ 语音：**${voicePending}** 条待处理，共计 ${scriptAll} 条；输入「TTS」查看语音列表，「TTS:{ID}」进入语音生成流程；`);
  console.log(`④ 节目：**${pubPending}** 条待处理，共计 ${totalEpisodes} 条；输入「节目」查看节目列表，「节目:{ID}」进入节目/发布流程；`);
  console.log("其他：");
  console.log(`· 嘉宾：**${guestsList.length}** 位（声线就绪 **${voiceReadyGuests}** 位）——入口「配置嘉宾」「配置嘉宾声线」`);
  console.log(`· 播放列表：**${playlists.length}** 个（共 **${playlistEpisodes}** 期）——入口「配置播放列表」`);
  console.log(`· 下线申请：**${removals.length}** 条待审批——入口「节目」`);
  console.log("· 更多入口：「批量采集」「重新生成:{ID}」「配置」");
  console.log("___");
  // 待处理选项：按流水线阶段生成（猜测下一步意图）——采集→脚本→语音→发布，有积压才出现
  const pendingMenu: string[] = [];
  if (submitted.length > 0) pendingMenu.push(`[${pendingMenu.length + 1}] 📥 批量采集 ${submitted.length} 条投稿`);
  if (scriptPending > 0) pendingMenu.push(`[${pendingMenu.length + 1}] ✍️ 处理 ${scriptPending} 条已采集未出脚本`);
  if (voicePending > 0) pendingMenu.push(`[${pendingMenu.length + 1}] 🔊 合成 ${voicePending} 条已出脚本未出语音`);
  if (pubPending > 0) pendingMenu.push(`[${pendingMenu.length + 1}] 📦 发布 ${pubPending} 条已合成未发布`);
  if (pendingMenu.length > 0) {
    console.log("**待处理选项（按流水线阶段——选号进入对应流程）**");
    pendingMenu.forEach((m) => console.log(m));
  } else {
    console.log("**待处理选项**：无（各管道已清空）");
  }

  if (email === "（未登录）") {
    console.error("[overview] 未配对或端点不可达：计数显示 0。请先执行 pnpm editor login" + (config.envName ? ` --env ${config.envName}` : ""));
  }
}
