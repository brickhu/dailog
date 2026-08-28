// 批量提取（第一步：只做提取，展示分组结果，询问处置）
//   pnpm editor batch [--limit N]
//   ① 队列（submitted）逐个（并发）：已提取（dialogue.json 就绪）→ 跳过
//   ② 提取结果分三类：
//      ✅ 成功（消息双全）→ 展示 N 轮对话
//      ❌ 触达失败（网络异常/404 失效/非 HTML）→ 地址无法触达
//      ⚠️ 解码失败（403 反爬/未提取到消息/消息不全/内容过短）→ 附原因
//   ③ 分组呈现（url + email + 详情）→ 请管理员给处置意见
//   处置后续：✅ 组进入脚本生成；❌/⚠️ 组由管理员决定（拒审/人工处理/跳过）
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EditorConfig } from "./lib.js";
import { api, draftDir } from "./lib.js";
import { extractSubmission, isTooShort, rejectShort, SHORT_REASON, MIN_USER_TURNS, MIN_CHARS } from "./fetch.js";

/** 提取并发数（网络 IO 密集，并发提速；LLM 无涉） */
const CONCURRENCY = 4;

interface QueueRow {
  id: string;
  url: string;
  title: string | null;
  userEmail: string;
}

interface ResultRow {
  id: string;
  url: string;
  email: string;
  status: "ok" | "unreachable" | "decode_failed" | "rejected";
  detail: string;
  turns?: number;
}

async function extractOne(config: EditorConfig, row: QueueRow): Promise<ResultRow | null> {
  const dir = draftDir(row.id);
  if (existsSync(join(dir, "dialogue.json"))) {
    return null; // 已提取 → 跳过
  }
  const result = await extractSubmission(config, row.id);
  const base = { id: row.id, url: row.url, email: row.userEmail };
  if (!result.ok) {
    // 触达失败（网络/HTTP 层）vs 解码失败（拉到了但内容拿不出）
    const isReachFail = /拉取失败|HTTP|响应不是 HTML/.test(result.error ?? "");
    return {
      ...base,
      status: isReachFail ? "unreachable" : "decode_failed",
      detail: isReachFail ? "地址无法触达" : result.error!.replace(/^未提取到消息（|）$/g, ""),
    };
  }
  const users = result.messages!.filter((m) => m.role === "user").length;
  const words = result.messages!.reduce((n, m) => n + m.content.length, 0);
  if (isTooShort(users, words)) {
    await rejectShort(config, row.id, users, words); // 直接拒审，不落草稿
    return { ...base, status: "rejected", detail: SHORT_REASON };
  }
  return { ...base, status: "ok", detail: `${users} 轮对话`, turns: users };
}

export async function batch(config: EditorConfig, args: string[]): Promise<void> {
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : 10;
  const rows = (await api(config, "/v1/editor/submissions")) as QueueRow[];
  const targets = rows.slice(0, limit);
  if (targets.length === 0) {
    console.log("[batch] 队列为空");
    return;
  }
  console.log(`[batch] 队列 ${rows.length} 条，本次提取 ${targets.length} 条（并发 ${CONCURRENCY}）…`);

  // 并发提取
  const results: ResultRow[] = [];
  let skipped = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map((row) => extractOne(config, row)));
    for (const r of chunkResults) {
      if (r) results.push(r);
      else skipped++;
    }
  }

  // 分组展示（用户模板格式）
  const ok = results.filter((r) => r.status === "ok");
  const unreachable = results.filter((r) => r.status === "unreachable");
  const decodeFailed = results.filter((r) => r.status === "decode_failed");
  const rejected = results.filter((r) => r.status === "rejected");

  console.log(`\n已解析了 ${results.length} 条投稿（跳过已提取 ${skipped} 条）：`);
  let idx = 0;
  for (const r of results) {
    idx++;
    const mark = r.status === "ok" ? "✅" : r.status === "rejected" ? "⛔" : r.status === "unreachable" ? "❌" : "⚠️";
    console.log(`${idx}. ${mark} ${r.url} - ${r.email} - ${r.detail}`);
  }

  console.log("\n========== 分组汇总 ==========");
  console.log(`✅ 提取成功（${ok.length}）→ 可进入脚本生成`);
  console.log(`⛔ 内容过短已直接拒审（${rejected.length}）→ 原因：${SHORT_REASON}`);
  console.log(`❌ 触达失败（${unreachable.length}）→ 链接不可达`);
  console.log(`⚠️ 解码失败（${decodeFailed.length}）→ 反爬/内容问题`);
  console.log(`已提取跳过（${skipped}）`);

  console.log("\n处置：✅ 组继续生成脚本；❌/⚠️ 组拒审（附原因）/ 人工处理 / 跳过；⛔ 组已自动拒审无需处理");
}
