export interface QueueJob { id: string; episodeId: string; }
export type JobUpdate = (progress: number) => Promise<void>;
export type JobHandler = (job: QueueJob, update: JobUpdate) => Promise<{ status: "done" | "failed"; error?: string }>;

export interface QueueOptions { concurrency: number; maxAttempts: number; backoffMs: number; }

/** 进程内串行队列：重试 + 指数退避；MVP 单实例（ARC §3.1） */
export function createJobQueue(handler: JobHandler, opts: QueueOptions) {
  const pending: Array<{ job: QueueJob; onProgress: (p: number) => void; resolve: (r: { status: string; error?: string }) => void }> = [];
  let running = false;

  async function pump() {
    if (running || pending.length === 0) return;
    running = true;
    const { job, onProgress, resolve } = pending.shift()!;
    try {
      let lastError: unknown;
      for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
        try {
          const r = await handler(job, async (p) => { onProgress(p); });
          resolve(r);
          return;
        } catch (e) {
          lastError = e;
          if (attempt < opts.maxAttempts) await new Promise((r) => setTimeout(r, opts.backoffMs * 2 ** (attempt - 1)));
        }
      }
      resolve({ status: "failed", error: String(lastError instanceof Error ? lastError.message : lastError) });
    } finally {
      running = false;
      void pump();
    }
  }

  return {
    enqueue(job: QueueJob, onProgress: (p: number) => void): Promise<{ status: string; error?: string }> {
      return new Promise((resolve) => { pending.push({ job, onProgress, resolve }); void pump(); });
    },
  };
}
