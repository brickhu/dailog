import type { QueueJob } from "./queue";

export interface RecoveryRepo {
  listRecoverableJobs(): Promise<QueueJob[]>; // status in (queued, tts, merge, upload)
}

/** 启动时把未完成 job 重新入队（进程内队列 MVP：重启恢复） */
export async function recoverQueuedJobs(repo: RecoveryRepo, enqueue: (job: QueueJob) => Promise<void>): Promise<number> {
  const jobs = await repo.listRecoverableJobs();
  for (const job of jobs) await enqueue(job);
  return jobs.length;
}
