import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema";
import type { ScriptSegment } from "../db/schema";
import type { VoiceSampleRow } from "../routes/voice";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

/** slug 占用查询（排除用户自己）：updateChannel 与 isUsernameTaken 共用 */
function usernameTaken(db: PostgresJsDatabase<typeof schema>, userId: string, username: string): Promise<boolean> {
  return db
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.username, username), ne(schema.profiles.id, userId)))
    .limit(1)
    .then((rows) => rows.length > 0);
}

function randomSlug(): string {
  return randomBytes(8).toString("hex");
}

export type JobStatus = "queued" | "tts" | "merge" | "upload" | "done" | "failed";

export interface SnapshotRow {
  url: string;
  platform: string;
  sourceTitle: string | null;
  sourceConversationId: string | null;
  parsedDialogue: unknown;
}

export interface SnapshotsRepo {
  /** 快照查询（URL 唯一）——命中即复用，不重复采集 */
  /** 按 id 查（polish → snapshot 对话用） */
  getById(id: string): Promise<{ parsedDialogue: unknown; sourceTitle: string | null } | null>;
  getByUrl(url: string): Promise<{
    id: string;
    platform: string;
    sourceTitle: string | null;
    sourceConversationId: string | null;
    parsedDialogue: unknown;
    quality: schema.QualityResult | null;
    status: "ok" | "unreachable" | "parse_failed";
    retryAfter: Date | null;
    lastError: string | null;
  } | null>;
  create(row: SnapshotRow): Promise<{ id: string }>;
  /** 采集成功落库（内容 + meta + status=ok，清 retryAfter） */
  updateContent(id: string, row: SnapshotRow): Promise<void>;
  /** 质量分析结果写快照（内容固定 → 分析一次全局复用） */
  updateQuality(id: string, quality: schema.QualityResult): Promise<void>;
  /** 触达失败：status=unreachable，retryAfter=10 分钟后 */
  markUnreachable(id: string, error: string): Promise<void>;
  markParseFailed(id: string, error: string): Promise<void>;
}

export interface PolishRow {
  userId: string;
  snapshotId: string;
  title: string | null;
}

export interface PolishesRepo {
  /** 用户 × 快照唯一：已存在 → 跳转编辑页（继续创作） */
  findByUserSnapshot(userId: string, snapshotId: string): Promise<{ id: string; title: string | null; status: string } | null>;
  create(row: PolishRow): Promise<{ id: string }>;
  /** 归属校验（防 IDOR）+ 快照关联 */
  getOwned(id: string, userId: string): Promise<{ id: string; snapshotId: string; title: string | null; status: string } | null>;
  /** 编辑页详情：polish + 快照 meta + transcripts */
  getPolishDetail(id: string, userId: string): Promise<{
    id: string;
    title: string | null;
    snapshotTitle: string | null;
    snapshotUrl: string | null;
    quality: schema.QualityResult | null;
    transcripts: { id: string; segments: schema.ScriptSegment[]; language: string | null; createdAt: Date }[];
  } | null>;
  /** 工作台列表：polish + 快照标题 + 节目状态 */
  listByUser(userId: string): Promise<{
    id: string;
    title: string | null;
    status: string;
    snapshotTitle: string | null;
    episodeId: string | null;
    episodeStatus: string | null;
    createdAt: Date;
  }[]>;
}

export interface TranscriptsRepo {
  create(polishId: string, segments: ScriptSegment[], language: string | null): Promise<{ id: string }>;
  listByPolish(polishId: string): Promise<{ id: string; segments: ScriptSegment[]; language: string | null; createdAt: Date }[]>;
  /** 归属校验（join polish.user_id） */
  getOwned(id: string, userId: string): Promise<{ id: string; polishId: string; segments: ScriptSegment[]; language: string | null } | null>;
  updateSegments(id: string, segments: ScriptSegment[]): Promise<void>;
}

export interface EpisodeRow {
  userId: string;
  transcriptId: string;
  polishId: string;
  title: string | null;
  description?: string | null;
}

export interface EpisodesRepo {
  /** 创建节目（由 transcript 生成；slug 随机） */
  create(row: EpisodeRow): Promise<{ id: string }>;
  listByUser(userId: string): Promise<{
    id: string;
    title: string | null;
    status: string;
    polishId: string;
    createdAt: Date;
  }[]>;
  getOwned(id: string, userId: string): Promise<{ id: string; transcriptId: string; polishId: string; title: string | null; status: string } | null>;
  /** 工作台试听：episode 音频 storage key（归属过滤） */
  getEpisodeAudio(id: string, userId: string): Promise<string | null>;
  /** 生成管线来源脚本：经 episodes.transcript_id → transcripts.segments */
  getEpisodeScript(episodeId: string): Promise<{ segments: ScriptSegment[] } | null>;
  /** 内容站公开读：仅已发布可见；对话内容在 snapshots.parsedDialogue（join 链） */
  getPublishedDialogue(episodeId: string): Promise<{
    platform: string;
    sourceTitle: string | null;
    sourceUrl: string;
    parsedDialogue: unknown;
  } | null>;
  setPublished(id: string): Promise<void>;
  getEpisodeUserId(episodeId: string): Promise<string | null>;
  /** 语言随 transcript（join 链） */
  getEpisodeLanguage(episodeId: string): Promise<string | null>;
  // ---- voice/channel 相关（沿用） ----
  getHostModelId(userId: string): Promise<string | null>;
  getVoiceSampleKey(userId: string): Promise<string | null>;
  getVoiceSample(userId: string): Promise<VoiceSampleRow | null>;
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
  getChannelActivatedAt(userId: string): Promise<Date | null>;
  // ---- 账号/频道（/api/me/profile、/api/me/channel） ----
  /** 账号 + 频道档案（hasGithub = account 表有 github 绑定）——昵称对外叫 nickname（列 user.name） */
  getProfile(userId: string): Promise<{
    email: string | null;
    nickname: string | null;
    emailVerified: boolean;
    image: string | null;
    hasGithub: boolean;
    username: string | null;
    displayName: string | null;
    bio: string | null;
    channelActivatedAt: Date | null;
  } | null>;
  updateUserNickname(userId: string, nickname: string): Promise<void>;
  /** 频道设置（slug/频道名/简介）；返回冲突：username 被占用 */
  updateChannel(userId: string, row: { username?: string; displayName?: string; bio?: string | null }): Promise<{ ok: true } | { error: "username_taken" }>;
  /** slug 占用检测（排除自己；PATCH /api/me/channel 内部同样复用） */
  isUsernameTaken(userId: string, username: string): Promise<boolean>;
}

export interface JobsRepo {
  getQuotaInfo(userId: string): Promise<{ plan: "free" | "pro"; generatedCount: number; creditBalance: number }>;
  consumeQuota(userId: string, credit: number): Promise<void>;
  createJob(episodeId: string): Promise<{ id: string; episodeId: string; status: string; progress: number }>;
  getLatestJob(episodeId: string): Promise<{ id: string; status: string; progress: number; error: string | null } | null>;
  getOwnedEpisode(episodeId: string, userId: string): Promise<{ id: string } | null>;
  listRecoverableJobs(): Promise<{ id: string; episodeId: string }[]>;
  markJobProgress(jobId: string, status: JobStatus, progress: number): Promise<void>;
  markJobDone(jobId: string): Promise<void>;
  updateEpisodeAudio(episodeId: string, audioKey: string, durationSeconds: number): Promise<void>;
  markJobFailed(jobId: string, error: string): Promise<void>;
}

export type Repos = {
  snapshots: SnapshotsRepo;
  polishes: PolishesRepo;
  transcripts: TranscriptsRepo;
  episodes: EpisodesRepo;
  jobs: JobsRepo;
};

export function createRepo(db: PostgresJsDatabase<typeof schema>): Repos {
  return {
    snapshots: {
      async getById(id) {
        const rows = await db
          .select({ parsedDialogue: schema.snapshots.parsedDialogue, sourceTitle: schema.snapshots.sourceTitle })
          .from(schema.snapshots)
          .where(eq(schema.snapshots.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async getByUrl(url) {
        const rows = await db
          .select({
            id: schema.snapshots.id,
            platform: schema.snapshots.platform,
            sourceTitle: schema.snapshots.sourceTitle,
            sourceConversationId: schema.snapshots.sourceConversationId,
            parsedDialogue: schema.snapshots.parsedDialogue,
            quality: schema.snapshots.quality,
            status: schema.snapshots.status,
            retryAfter: schema.snapshots.retryAfter,
            lastError: schema.snapshots.lastError,
          })
          .from(schema.snapshots)
          .where(eq(schema.snapshots.url, url))
          .limit(1);
        return rows[0] ?? null;
      },
      async create(row) {
        const rows = await db.insert(schema.snapshots).values({
          url: row.url,
          platform: row.platform as never,
          sourceTitle: row.sourceTitle,
          sourceConversationId: row.sourceConversationId,
          parsedDialogue: row.parsedDialogue,
        }).returning({ id: schema.snapshots.id });
        return { id: rows[0].id };
      },
      async updateContent(id, row) {
        await db.update(schema.snapshots)
          .set({
            platform: row.platform as never,
            sourceTitle: row.sourceTitle,
            sourceConversationId: row.sourceConversationId,
            parsedDialogue: row.parsedDialogue,
            status: "ok",
            lastError: null,
            retryAfter: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.snapshots.id, id));
      },
      async updateQuality(id, quality) {
        await db.update(schema.snapshots)
          .set({ quality, updatedAt: new Date() })
          .where(eq(schema.snapshots.id, id));
      },
      async markUnreachable(id, error) {
        await db.update(schema.snapshots)
          .set({
            status: "unreachable",
            lastError: error,
            retryAfter: new Date(Date.now() + 10 * 60 * 1000),
            updatedAt: new Date(),
          })
          .where(eq(schema.snapshots.id, id));
      },
      async markParseFailed(id, error) {
        await db.update(schema.snapshots)
          .set({ status: "parse_failed", lastError: error, updatedAt: new Date() })
          .where(eq(schema.snapshots.id, id));
      },
    },

    polishes: {
      async findByUserSnapshot(userId, snapshotId) {
        const rows = await db
          .select({ id: schema.polishes.id, title: schema.polishes.title, status: schema.polishes.status })
          .from(schema.polishes)
          .where(and(eq(schema.polishes.userId, userId), eq(schema.polishes.snapshotId, snapshotId)))
          .limit(1);
        return rows[0] ?? null;
      },
      async create(row) {
        try {
          const rows = await db.insert(schema.polishes).values(row).returning({ id: schema.polishes.id });
          return { id: rows[0].id };
        } catch (err) {
          if (isUniqueViolation(err)) return { id: "" }; // 竞态：并发创建撞唯一约束
          throw err;
        }
      },
      async getOwned(id, userId) {
        const rows = await db
          .select({
            id: schema.polishes.id,
            snapshotId: schema.polishes.snapshotId,
            title: schema.polishes.title,
            status: schema.polishes.status,
          })
          .from(schema.polishes)
          .where(and(eq(schema.polishes.id, id), eq(schema.polishes.userId, userId)))
          .limit(1);
        return rows[0] ?? null;
      },
      async getPolishDetail(id, userId) {
        const rows = await db
          .select({
            id: schema.polishes.id,
            title: schema.polishes.title,
            snapshotTitle: schema.snapshots.sourceTitle,
            snapshotUrl: schema.snapshots.url,
            quality: schema.snapshots.quality,
          })
          .from(schema.polishes)
          .innerJoin(schema.snapshots, eq(schema.polishes.snapshotId, schema.snapshots.id))
          .where(and(eq(schema.polishes.id, id), eq(schema.polishes.userId, userId)))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        const transcripts = await db
          .select({ id: schema.transcripts.id, segments: schema.transcripts.segments, language: schema.transcripts.language, createdAt: schema.transcripts.createdAt })
          .from(schema.transcripts)
          .where(eq(schema.transcripts.polishId, id))
          .orderBy(desc(schema.transcripts.createdAt));
        return {
          id: row.id,
          title: row.title,
          snapshotTitle: row.snapshotTitle,
          snapshotUrl: row.snapshotUrl,
          quality: row.quality ?? null,
          transcripts,
        };
      },
      async listByUser(userId) {
        // 工作台：polish 列表 + 快照标题；每 polish 最新节目状态在 JS 里归并（数据量小）
        const polishRows = await db
          .select({
            id: schema.polishes.id,
            title: schema.polishes.title,
            status: schema.polishes.status,
            snapshotTitle: schema.snapshots.sourceTitle,
            createdAt: schema.polishes.createdAt,
          })
          .from(schema.polishes)
          .innerJoin(schema.snapshots, eq(schema.polishes.snapshotId, schema.snapshots.id))
          .where(eq(schema.polishes.userId, userId))
          .orderBy(desc(schema.polishes.createdAt));
        const epRows = await db
          .select({
            id: schema.episodes.id,
            polishId: schema.episodes.polishId,
            status: schema.episodes.status,
            createdAt: schema.episodes.createdAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.userId, userId))
          .orderBy(desc(schema.episodes.createdAt));
        const latestByPolish = new Map<string, { id: string; status: string }>();
        for (const ep of epRows) {
          if (!latestByPolish.has(ep.polishId)) latestByPolish.set(ep.polishId, { id: ep.id, status: ep.status });
        }
        return polishRows.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          snapshotTitle: p.snapshotTitle,
          episodeId: latestByPolish.get(p.id)?.id ?? null,
          episodeStatus: latestByPolish.get(p.id)?.status ?? null,
          createdAt: p.createdAt,
        }));
      },
    },

    transcripts: {
      async create(polishId, segments, language) {
        const rows = await db.insert(schema.transcripts).values({ polishId, segments, language })
          .returning({ id: schema.transcripts.id });
        return { id: rows[0].id };
      },
      async listByPolish(polishId) {
        return db
          .select({ id: schema.transcripts.id, segments: schema.transcripts.segments, language: schema.transcripts.language, createdAt: schema.transcripts.createdAt })
          .from(schema.transcripts)
          .where(eq(schema.transcripts.polishId, polishId))
          .orderBy(desc(schema.transcripts.createdAt));
      },
      async getOwned(id, userId) {
        const rows = await db
          .select({
            id: schema.transcripts.id,
            polishId: schema.transcripts.polishId,
            segments: schema.transcripts.segments,
            language: schema.transcripts.language,
          })
          .from(schema.transcripts)
          .innerJoin(schema.polishes, eq(schema.transcripts.polishId, schema.polishes.id))
          .where(and(eq(schema.transcripts.id, id), eq(schema.polishes.userId, userId)))
          .limit(1);
        return rows[0] ?? null;
      },
      async updateSegments(id, segments) {
        await db.update(schema.transcripts).set({ segments }).where(eq(schema.transcripts.id, id));
      },
    },

    episodes: {
      async create(row) {
        const rows = await db.insert(schema.episodes).values({
          userId: row.userId,
          transcriptId: row.transcriptId,
          polishId: row.polishId,
          slug: randomSlug(),
          title: row.title,
          description: row.description ?? null,
        }).returning({ id: schema.episodes.id });
        return { id: rows[0].id };
      },
      async listByUser(userId) {
        return db
          .select({
            id: schema.episodes.id,
            title: schema.episodes.title,
            status: schema.episodes.status,
            polishId: schema.episodes.polishId,
            createdAt: schema.episodes.createdAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.userId, userId))
          .orderBy(desc(schema.episodes.createdAt));
      },
      async getOwned(id, userId) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            transcriptId: schema.episodes.transcriptId,
            polishId: schema.episodes.polishId,
            title: schema.episodes.title,
            status: schema.episodes.status,
          })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.id, id), eq(schema.episodes.userId, userId)))
          .limit(1);
        return rows[0] ?? null;
      },
      async getEpisodeAudio(id, userId) {
        const rows = await db
          .select({ audioUrl: schema.episodes.audioUrl })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.id, id), eq(schema.episodes.userId, userId)))
          .limit(1);
        return rows[0]?.audioUrl ?? null;
      },
      async getEpisodeScript(episodeId) {
        const rows = await db
          .select({ segments: schema.transcripts.segments })
          .from(schema.episodes)
          .innerJoin(schema.transcripts, eq(schema.episodes.transcriptId, schema.transcripts.id))
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        const row = rows[0];
        return row ? { segments: row.segments as ScriptSegment[] } : null;
      },
      async getPublishedDialogue(episodeId) {
        const rows = await db
          .select({
            platform: schema.snapshots.platform,
            sourceTitle: schema.snapshots.sourceTitle,
            sourceUrl: schema.snapshots.url,
            parsedDialogue: schema.snapshots.parsedDialogue,
          })
          .from(schema.episodes)
          .innerJoin(schema.polishes, eq(schema.episodes.polishId, schema.polishes.id))
          .innerJoin(schema.snapshots, eq(schema.polishes.snapshotId, schema.snapshots.id))
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.isPublic, true)))
          .limit(1);
        const row = rows[0];
        return row ? { platform: row.platform, sourceTitle: row.sourceTitle ?? null, sourceUrl: row.sourceUrl, parsedDialogue: row.parsedDialogue } : null;
      },
      async setPublished(id) {
        await db.update(schema.episodes)
          .set({ status: "published", isPublic: true, publishedAt: new Date() })
          .where(eq(schema.episodes.id, id));
      },
      async getEpisodeUserId(episodeId) {
        const rows = await db
          .select({ userId: schema.episodes.userId })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.userId ?? null;
      },
      async getEpisodeLanguage(episodeId) {
        const rows = await db
          .select({ language: schema.transcripts.language })
          .from(schema.episodes)
          .innerJoin(schema.transcripts, eq(schema.episodes.transcriptId, schema.transcripts.id))
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.language ?? null;
      },
      async getHostModelId(userId) {
        const rows = await db
          .select({ referenceId: schema.voiceSamples.referenceId })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.status, "ready")))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return rows[0]?.referenceId ?? null;
      },
      async getVoiceSampleKey(userId) {
        const rows = await db
          .select({ audioUrl: schema.voiceSamples.audioUrl })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.status, "ready")))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return rows[0]?.audioUrl ?? null;
      },
      async getVoiceSample(userId) {
        const rows = await db
          .select({
            id: schema.voiceSamples.id,
            userId: schema.voiceSamples.userId,
            status: schema.voiceSamples.status,
            referenceId: schema.voiceSamples.referenceId,
            transcript: schema.voiceSamples.transcript,
            audioUrl: schema.voiceSamples.audioUrl,
            duration: schema.voiceSamples.duration,
            createdAt: schema.voiceSamples.createdAt,
          })
          .from(schema.voiceSamples)
          .where(eq(schema.voiceSamples.userId, userId))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },
      async getChannelActivatedAt(userId) {
        const rows = await db
          .select({ channelActivatedAt: schema.profiles.channelActivatedAt })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        return rows[0]?.channelActivatedAt ?? null;
      },
      async saveVoiceSample(row: VoiceSampleRow) {
        await db.transaction(async (tx) => {
          await tx.delete(schema.voiceSamples).where(eq(schema.voiceSamples.userId, row.userId));
          await tx.insert(schema.voiceSamples).values({
            userId: row.userId,
            audioUrl: row.audioUrl,
            referenceId: row.referenceId,
            transcript: row.transcript,
            duration: row.duration,
            status: row.status,
          });
        });
      },

      // ---- 账号/频道（/api/me/profile、/api/me/channel） ----
      async getProfile(userId) {
        const [userRows, profileRows, accountRows] = await Promise.all([
          db
            .select({ email: schema.authUsers.email, name: schema.authUsers.name, emailVerified: schema.authUsers.emailVerified, image: schema.authUsers.image })
            .from(schema.authUsers)
            .where(eq(schema.authUsers.id, userId))
            .limit(1),
          db
            .select({ username: schema.profiles.username, displayName: schema.profiles.displayName, bio: schema.profiles.bio, channelActivatedAt: schema.profiles.channelActivatedAt })
            .from(schema.profiles)
            .where(eq(schema.profiles.id, userId))
            .limit(1),
          db
            .select({ id: schema.authAccounts.id })
            .from(schema.authAccounts)
            .where(and(eq(schema.authAccounts.userId, userId), eq(schema.authAccounts.providerId, "github")))
            .limit(1),
        ]);
        const user = userRows[0];
        const profile = profileRows[0];
        if (!user || !profile) return null;
        return {
          email: user.email,
          nickname: user.name, // 对外契约 nickname；DB 列 user.name 是 better-auth 标准字段
          emailVerified: user.emailVerified,
          image: user.image,
          hasGithub: accountRows.length > 0,
          username: profile.username,
          displayName: profile.displayName,
          bio: profile.bio,
          channelActivatedAt: profile.channelActivatedAt,
        };
      },
      async updateUserNickname(userId, nickname) {
        await db.update(schema.authUsers).set({ name: nickname, updatedAt: new Date() }).where(eq(schema.authUsers.id, userId));
      },
      async updateChannel(userId, row) {
        if (row.username !== undefined) {
          if (await usernameTaken(db, userId, row.username)) return { error: "username_taken" };
        }
        await db.update(schema.profiles)
          .set({
            ...(row.username !== undefined ? { username: row.username } : {}),
            ...(row.displayName !== undefined ? { displayName: row.displayName } : {}),
            ...(row.bio !== undefined ? { bio: row.bio } : {}),
          })
          .where(eq(schema.profiles.id, userId));
        return { ok: true };
      },
      async isUsernameTaken(userId, username) {
        return usernameTaken(db, userId, username);
      },
    },

    jobs: {
      async getQuotaInfo(userId) {
        const profileRows = await db
          .select({ plan: schema.profiles.plan, creditBalance: schema.profiles.creditBalance })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        const profile = profileRows[0];
        if (!profile) return { plan: "free", generatedCount: 0, creditBalance: 0 };
        const doneRows = await db
          .select({ count: count() })
          .from(schema.generationJobs)
          .innerJoin(schema.episodes, eq(schema.generationJobs.episodeId, schema.episodes.id))
          .where(and(eq(schema.episodes.userId, userId), eq(schema.generationJobs.status, "done")));
        return {
          plan: profile.plan,
          generatedCount: Number(doneRows[0].count),
          creditBalance: profile.creditBalance,
        };
      },
      async consumeQuota(userId, credit) {
        if (credit <= 0) return;
        await db.update(schema.profiles)
          .set({ creditBalance: sql`${schema.profiles.creditBalance} - ${credit}` })
          .where(and(eq(schema.profiles.id, userId), eq(schema.profiles.plan, "free")));
      },
      async createJob(episodeId) {
        const rows = await db.insert(schema.generationJobs).values({
          episodeId,
          status: "queued",
          progress: 0,
        }).returning({
          id: schema.generationJobs.id,
          episodeId: schema.generationJobs.episodeId,
          status: schema.generationJobs.status,
          progress: schema.generationJobs.progress,
        });
        return rows[0];
      },
      async markJobFailed(jobId, error) {
        await db
          .update(schema.generationJobs)
          .set({ status: "failed", error })
          .where(eq(schema.generationJobs.id, jobId));
      },
      async getOwnedEpisode(episodeId, userId) {
        const rows = await db
          .select({ id: schema.episodes.id })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.userId, userId)))
          .limit(1);
        return rows[0] ?? null;
      },
      async getLatestJob(episodeId) {
        const rows = await db
          .select({
            id: schema.generationJobs.id,
            status: schema.generationJobs.status,
            progress: schema.generationJobs.progress,
            error: schema.generationJobs.error,
          })
          .from(schema.generationJobs)
          .where(eq(schema.generationJobs.episodeId, episodeId))
          .orderBy(desc(schema.generationJobs.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },
      async listRecoverableJobs() {
        return db
          .select({ id: schema.generationJobs.id, episodeId: schema.generationJobs.episodeId })
          .from(schema.generationJobs)
          .where(inArray(schema.generationJobs.status, ["queued", "tts", "merge", "upload"]));
      },
      async markJobProgress(jobId, status, progress) {
        await db.update(schema.generationJobs)
          .set({ status, progress, updatedAt: new Date() })
          .where(eq(schema.generationJobs.id, jobId));
      },
      async markJobDone(jobId) {
        await db.update(schema.generationJobs)
          .set({ status: "done", progress: 100, error: null, updatedAt: new Date() })
          .where(eq(schema.generationJobs.id, jobId));
      },
      async updateEpisodeAudio(episodeId, audioKey, durationSeconds) {
        await db.update(schema.episodes)
          .set({ audioUrl: audioKey, durationSeconds: Math.round(durationSeconds) })
          .where(eq(schema.episodes.id, episodeId));
      },
    },
  };
}
