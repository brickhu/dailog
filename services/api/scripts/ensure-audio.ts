// 恢复/补齐本地节目的音频（宿主运行：proxy + R2 + ffmpeg 都在宿主机可达）。
// 用法：node --env-file-if-exists=.env.local node_modules/tsx/dist/cli.mjs scripts/ensure-audio.ts
//  - 对指定 episodeId：创建 job 并跑完整生成管线（与 src/index.ts 同款 runner）
//  - 对已上传音频但 track 行缺失的 episode：补写 track 行
import { createDb } from "../src/db/client";
import type { Env } from "../src/config/env";
import { createRepo } from "../src/repo";
import { createStorage } from "../src/storage";
import { createTtsClient } from "../src/tts/client";
import { createProxyFetch } from "../src/net/proxy";
import { createPipelineRunner } from "../src/pipeline/runner";
import { createJobQueue } from "../src/pipeline/queue";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";


async function main() {
  const url = process.env.DATABASE_URL!;
  const dbClient = createDb({ DATABASE_URL: url } as Env);
  const db = dbClient.db;
  const repo = createRepo(db);
  const storage = createStorage({
    driver: (process.env.STORAGE_DRIVER as "fs" | "r2") ?? "fs",
    dir: process.env.STORAGE_DIR ?? "./data",
    r2: {
      accountId: process.env.R2_ACCOUNT_ID ?? "",
      accessKey: process.env.R2_ACCESS_KEY ?? "",
      secretKey: process.env.R2_SECRET_KEY ?? "",
      bucket: process.env.R2_BUCKET ?? "",
    },
  });

  const tts = createTtsClient({
    apiKey: process.env.FISH_API_KEY ?? "",
    fetchImpl: createProxyFetch(process.env.FISH_PROXY_URL ?? null),
  });

  // 1) 检查历史 job 失败但音频已上传的 episode（insertTrack 取整修复前：upload 成功、track 行缺失）
  const staleRows = await dbClient.client.unsafe(`
    SELECT j.episode_id, j.error
    FROM generation_jobs j
    WHERE j.status = 'failed' AND j.progress >= 90 AND j.error LIKE '%invalid input syntax%'
  `);
  for (const row of staleRows) {
    const userId = await repo.episodes.getEpisodeUserId(row.episode_id);
    const key = `episodes/${userId}/${row.episode_id}.mp3`;
    const audio = await storage.get(key).catch(() => null);
    if (audio && audio.length > 0) {
      // 时长从失败信息（164.05）取整；直接读文件探测更准，但此处仅补行
      const m = staleRows.find((r) => r.episode_id === row.episode_id)!.error.match(/(\d+\.\d+)/);
      const duration = m ? Math.round(Number(m[1])) : 0;
      await repo.episodes.insertTrack(row.episode_id, "zh", key, duration);
      console.log(`[ensure-audio] 补 track 行: ${row.episode_id} (${key}, ${duration}s)`);
    } else {
      console.log(`[ensure-audio] 音频不存在（需重跑）: ${row.episode_id}`);
    }
  }

  // 2) 跑真实管线（指定 episodeId）
  const episodeId = process.argv[2];
  if (episodeId) {
    const job = await repo.jobs.createJob(episodeId);
    console.log(`[ensure-audio] job ${job.id} 已创建，开始生成 ${episodeId}...`);
    const queue = createJobQueue(createPipelineRunner({
      repo: {
        getEpisodeUserId: repo.episodes.getEpisodeUserId,
        getEpisodeLanguage: repo.episodes.getEpisodeLanguage,
        getEpisodeScript: repo.episodes.getEpisodeScript,
        getVoiceSampleByLanguage: repo.episodes.getVoiceSampleByLanguage,
        getVoiceSample: repo.episodes.getVoiceSample,
        getGuestModelId: async () => null,
        markJobProgress: repo.jobs.markJobProgress,
        markJobDone: repo.jobs.markJobDone,
        insertTrack: repo.episodes.insertTrack,
      },
      tts,
      storage,
      assets: { get: (key) => storage.get(key).catch(() => null) },
      ffmpegPath: ffmpegInstaller.path,
    }), { concurrency: 1, maxAttempts: 2, backoffMs: 1000 });

    const result = await queue.enqueue(job, (p) => console.log(`[ensure-audio] progress ${p}%`));
    if (result.status === "failed") {
      await repo.jobs.markJobFailed(job.id, result.error ?? "unknown");
      console.error(`[ensure-audio] 生成失败: ${result.error}`);
      process.exitCode = 1;
    } else {
      console.log(`[ensure-audio] 生成完成 ✅ ${episodeId}`);
    }
  } else {
    console.log("[ensure-audio] 未指定 episodeId，仅补 track 行");
  }

  await dbClient.client.end().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
