import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema";
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

// ---------------------------------------------------------------------------
// 投稿（本质版）：用户提交 URL + 采样 → submitted；编辑本地制作后 reject / markPublished
// ---------------------------------------------------------------------------

export interface SubmissionsRepo {
  /** 投稿入库（唯一约束 user×url 兜底；重复提交由路由层查 findByUserUrl） */
  create(userId: string, url: string, title: string | null): Promise<{ id: string }>;
  /** 重复投稿检测（同用户同 URL → 已存在） */
  findByUserUrl(userId: string, url: string): Promise<{ id: string; status: string } | null>;
  /** 待审核投稿数（status=submitted）——投稿并发限制（pending_limit）用 */
  countPendingByUser(userId: string): Promise<number>;
  /** 我的投稿列表（submitted/rejected/published + 最新节目状态）；按投稿时间倒序 */
  listByUser(userId: string): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    status: string;
    rejectedReason: string | null;
    episodeStatus: string | null;
    createdAt: Date;
  }>>;
  /** 编辑队列：按状态筛选（缺省 submitted），submitted 按提交时间升序（inbox 先到先审）。
   *  附带投稿人信息与采样就绪标记（无采样 = 无法制作主持人克隆音色，先标注） */
  listQueue(status?: "submitted" | "rejected" | "published"): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    status: string;
    createdAt: Date;
    userEmail: string;
    displayName: string;
    hasVoiceSample: boolean;
  }>>;
  /** 编辑详情（无归属校验）：投稿 + 投稿人 + 最新声音采样（transcript 供本地 TTS 克隆） */
  getDetail(id: string): Promise<{
    id: string;
    userId: string;
    url: string;
    title: string | null;
    status: string;
    rejectedReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    userEmail: string;
    displayName: string;
    voiceSample: { audioUrl: string; transcript: string | null; language: string; status: string } | null;
  } | null>;
  /** 拒审（reason 必填） */
  reject(id: string, reason: string): Promise<void>;
  /** 编辑已上传成品 → published */
  markPublished(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// 节目（成品）：编辑一次性上传即发布（期号 max+1）
// ---------------------------------------------------------------------------

export interface EpisodeCreateRow {
  submissionId: string;
  userId: string;
  hostId?: string | null;
  guestId?: string | null;
  title: string | null;
  description?: string | null;
  coverUrl?: string | null;
  /** R2 storage key（编辑上传的成品音频） */
  audioUrl: string;
  audioSize?: number | null;
  durationSeconds?: number | null;
  language?: string;
  tags?: string[] | null;
}

export interface EpisodesRepo {
  /** 编辑一次性上传发布：slug + 期号（max+1，事务）+ published + isPublic，单事务 */
  createPublished(row: EpisodeCreateRow): Promise<{ id: string; number: number }>;
  /** 公开读封面（主站免鉴权端点用）：仅已发布且公开 */
  getPublicCoverKey(episodeId: string): Promise<string | null>;
  /** 公开读音频（主站免鉴权端点用）：仅已发布且公开；
   *  version = 发布时间（ETag 用） */
  getPublicAudioKey(episodeId: string): Promise<{ audioKey: string; version: string } | null>;
  /** 编辑端节目详情（无归属校验） */
  getById(id: string): Promise<{
    id: string;
    submissionId: string;
    title: string | null;
    description: string | null;
    coverUrl: string | null;
    tags: string[] | null;
    status: string;
    number: number | null;
    isPicked: boolean;
    createdAt: Date;
    publishedAt: Date | null;
  } | null>;
  /** 已发布节目编辑：tags / 精选标记 / 元数据 */
  updatePublished(id: string, row: { tags?: string[] | null; isPicked?: boolean; title?: string | null; description?: string | null; coverUrl?: string | null }): Promise<void>;
  /** 已发布节目清单（编辑端）：按期号倒序 */
  listPublished(): Promise<Array<{
    id: string;
    title: string | null;
    number: number | null;
    isPicked: boolean;
    tags: string[] | null;
    durationSeconds: number | null;
    publishedAt: Date | null;
  }>>;
  /** 按投稿列节目（编辑端详情用，无归属校验） */
  listBySubmission(submissionId: string): Promise<Array<{
    id: string;
    title: string | null;
    status: string;
    number: number | null;
    isPicked: boolean;
    createdAt: Date;
    publishedAt: Date | null;
  }>>;
  /** 节目归属投稿人（发布通知收件人用） */
  getEpisodeUserId(episodeId: string): Promise<string | null>;
  /** 角色读取（认证中间件注入用）；无 profile 行 → null（按 user 处理）。可选——旧测试 fake 不实现时按 user */
  getRole?(userId: string): Promise<"user" | "editor" | "admin" | null>;
  /** 管理员同步（部署自动预留）：把 ADMIN_EMAILS 列出的邮箱提升为 admin；返回更新数 */
  syncAdminRoles(emails: string[]): Promise<number>;
  // ---- 声音采样（voice 路由沿用） ----
  getVoiceSample(userId: string): Promise<VoiceSampleRow | null>;
  /** 按语种取采样（编辑本地 TTS 按脚本语言取用）；无该语种 → null（调用方用兜底） */
  getVoiceSampleByLanguage(userId: string, language: string): Promise<VoiceSampleRow | null>;
  getVoiceSampleKey(userId: string): Promise<string | null>;
  saveVoiceSample(row: VoiceSampleRow): Promise<void>;
  // ---- 账号/档案（/api/me/profile） ----
  /** 账号 + 档案——昵称对外叫 nickname（列 user.name） */
  getProfile(userId: string): Promise<{
    email: string | null;
    nickname: string | null;
    emailVerified: boolean;
    image: string | null;
    username: string | null;
    displayName: string | null;
    bio: string | null;
    channelActivatedAt: Date | null;
    /** 主持人默认人设（编辑制作时取用） */
    persona: schema.HostPersona | null;
  } | null>;
  updateUserNickname(userId: string, nickname: string): Promise<void>;
  /** 保存默认人设（覆盖整体；null = 清除） */
  updatePersona(userId: string, persona: schema.HostPersona | null): Promise<void>;
  /** 档案设置（username/displayName/bio）；返回冲突：username 被占用 */
  updateChannel(userId: string, row: { username?: string; displayName?: string; bio?: string | null }): Promise<{ ok: true } | { error: "username_taken" }>;
  /** slug 占用检测（排除自己） */
  isUsernameTaken(userId: string, username: string): Promise<boolean>;
}

export interface GuestVoiceSampleRow {
  id: string;
  guestId: string;
  language: string;
  audioKey: string;
  referenceId: string | null;
  transcript: string | null;
}

export interface GuestsRepo {
  getByPlatform(platform: string): Promise<{ id: string; name: string } | null>;
  list(): Promise<{ id: string; platform: string; name: string; avatar: string | null; intro: string | null; url: string | null }[]>;
  /** 嘉宾音频采样：按语种取（本地 TTS 同语种优先注入）；无该语种 → null（调用方兜底任意语种） */
  voiceSampleByLanguage(guestId: string, language: string): Promise<GuestVoiceSampleRow | null>;
  /** 兜底：该嘉宾任意语种采样（缺目标语种时用） */
  voiceSampleAny(guestId: string): Promise<GuestVoiceSampleRow | null>;
  /** 管理录入/更新（guest_id + language 唯一，upsert） */
  upsertVoiceSample(row: { guestId: string; language: string; audioKey: string; referenceId?: string | null; transcript?: string | null }): Promise<void>;
  /** 更新嘉宾称呼/简介（guests 表——节目中的称呼服务端配置） */
  update(id: string, row: { name?: string; intro?: string | null }): Promise<void>;
  /** 管理列表（join guests 展示名） */
  listVoiceSamples(): Promise<{
    id: string;
    guestId: string;
    guestName: string;
    language: string;
    audioKey: string;
    referenceId: string | null;
    transcript: string | null;
  }[]>;
}

export interface NotificationsRepo {
  /** 创建站内通知（拒审 / 上线） */
  create(row: { userId: string; type: "rejected" | "published"; title: string; body?: string | null; link?: string | null }): Promise<void>;
  /** 我的通知（新→旧，limit 50） */
  listByUser(userId: string): Promise<Array<{
    id: string; type: string; title: string; body: string | null; link: string | null;
    readAt: Date | null; createdAt: Date;
  }>>;
  /** 未读数 */
  unreadCount(userId: string): Promise<number>;
  /** 全部标记已读 */
  markAllRead(userId: string): Promise<void>;
  /** 用户邮箱（通知邮件收件人） */
  getEmailByUserId(userId: string): Promise<string | null>;
  /** 某时间点之后是否存在指定类型通知（拒审/上线后是否已通知投稿人——编辑端推断用） */
  existsAfter(userId: string, type: string, after: Date): Promise<boolean>;
  /** 是否已存在指向该链接的通知（发布通知 link=/episode/{id}——已通知推断） */
  existsByLink(link: string): Promise<boolean>;
}

export type Repos = {
  guests: GuestsRepo;
  submissions: SubmissionsRepo;
  episodes: EpisodesRepo;
  notifications: NotificationsRepo;
};

export function createRepo(db: PostgresJsDatabase<typeof schema>): Repos {
  return {
    notifications: {
      async create(row) {
        await db.insert(schema.notifications).values({
          userId: row.userId,
          type: row.type,
          title: row.title,
          body: row.body ?? null,
          link: row.link ?? null,
        });
      },
      async listByUser(userId) {
        return db
          .select({
            id: schema.notifications.id,
            type: schema.notifications.type,
            title: schema.notifications.title,
            body: schema.notifications.body,
            link: schema.notifications.link,
            readAt: schema.notifications.readAt,
            createdAt: schema.notifications.createdAt,
          })
          .from(schema.notifications)
          .where(eq(schema.notifications.userId, userId))
          .orderBy(desc(schema.notifications.createdAt))
          .limit(50);
      },
      async unreadCount(userId) {
        const rows = await db
          .select({ n: count() })
          .from(schema.notifications)
          .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
        return rows[0]?.n ?? 0;
      },
      async markAllRead(userId) {
        await db.update(schema.notifications)
          .set({ readAt: new Date() })
          .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
      },
      async getEmailByUserId(userId) {
        const rows = await db
          .select({ email: schema.authUsers.email })
          .from(schema.authUsers)
          .where(eq(schema.authUsers.id, userId))
          .limit(1);
        return rows[0]?.email ?? null;
      },
      async existsAfter(userId, type, after) {
        const rows = await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.notifications)
          .where(and(
            eq(schema.notifications.userId, userId),
            eq(schema.notifications.type, type as never),
            gte(schema.notifications.createdAt, after),
          ))
          .limit(1);
        return Number(rows[0]?.n ?? 0) > 0;
      },
      async existsByLink(link) {
        const rows = await db
          .select({ n: sql<number>`count(*)` })
          .from(schema.notifications)
          .where(eq(schema.notifications.link, link))
          .limit(1);
        return Number(rows[0]?.n ?? 0) > 0;
      },
    },

    guests: {
      async getByPlatform(platform) {
        const rows = await db
          .select({ id: schema.guests.id, name: schema.guests.name })
          .from(schema.guests)
          .where(eq(schema.guests.platform, platform as typeof schema.guests.platform.enumValues[number]))
          .limit(1);
        return rows[0] ?? null;
      },
      async list() {
        return db
          .select({ id: schema.guests.id, platform: schema.guests.platform, name: schema.guests.name, avatar: schema.guests.avatar, intro: schema.guests.intro, url: schema.guests.url })
          .from(schema.guests)
          .orderBy(schema.guests.platform);
      },
      async voiceSampleByLanguage(guestId, language) {
        const rows = await db
          .select({
            id: schema.guestVoiceSamples.id,
            guestId: schema.guestVoiceSamples.guestId,
            language: schema.guestVoiceSamples.language,
            audioKey: schema.guestVoiceSamples.audioKey,
            referenceId: schema.guestVoiceSamples.referenceId,
            transcript: schema.guestVoiceSamples.transcript,
          })
          .from(schema.guestVoiceSamples)
          .where(and(
            eq(schema.guestVoiceSamples.guestId, guestId),
            eq(schema.guestVoiceSamples.language, language),
          ))
          .limit(1);
        return rows[0] ?? null;
      },
      async voiceSampleAny(guestId) {
        const rows = await db
          .select({
            id: schema.guestVoiceSamples.id,
            guestId: schema.guestVoiceSamples.guestId,
            language: schema.guestVoiceSamples.language,
            audioKey: schema.guestVoiceSamples.audioKey,
            referenceId: schema.guestVoiceSamples.referenceId,
            transcript: schema.guestVoiceSamples.transcript,
          })
          .from(schema.guestVoiceSamples)
          .where(eq(schema.guestVoiceSamples.guestId, guestId))
          .orderBy(desc(schema.guestVoiceSamples.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },
      async upsertVoiceSample(row) {
        await db.insert(schema.guestVoiceSamples).values({
          guestId: row.guestId,
          language: row.language,
          audioKey: row.audioKey,
          referenceId: row.referenceId ?? null,
          transcript: row.transcript ?? null,
        }).onConflictDoUpdate({
          target: [schema.guestVoiceSamples.guestId, schema.guestVoiceSamples.language],
          set: {
            audioKey: row.audioKey,
            referenceId: row.referenceId ?? null,
            transcript: row.transcript ?? null,
          },
        });
      },
      async update(id, row) {
        await db.update(schema.guests)
          .set({
            ...(row.name !== undefined ? { name: row.name } : {}),
            ...(row.intro !== undefined ? { intro: row.intro } : {}),
          })
          .where(eq(schema.guests.id, id));
      },
      async listVoiceSamples() {
        return db
          .select({
            id: schema.guestVoiceSamples.id,
            guestId: schema.guestVoiceSamples.guestId,
            guestName: schema.guests.name,
            language: schema.guestVoiceSamples.language,
            audioKey: schema.guestVoiceSamples.audioKey,
            referenceId: schema.guestVoiceSamples.referenceId,
            transcript: schema.guestVoiceSamples.transcript,
          })
          .from(schema.guestVoiceSamples)
          .innerJoin(schema.guests, eq(schema.guests.id, schema.guestVoiceSamples.guestId))
          .orderBy(schema.guests.platform);
      },
    },

    submissions: {
      /** 投稿入库（唯一约束 user×url 兜底；重复提交由路由层查 existing） */
      async create(userId, url, title) {
        try {
          const rows = await db.insert(schema.submissions).values({
            userId,
            url,
            title: title ?? null,
            status: "submitted",
          }).returning({ id: schema.submissions.id });
          return { id: rows[0].id };
        } catch (err) {
          if (isUniqueViolation(err)) return { id: "" }; // 竞态：并发提交撞唯一约束
          throw err;
        }
      },
      async findByUserUrl(userId, url) {
        const rows = await db
          .select({ id: schema.submissions.id, status: schema.submissions.status })
          .from(schema.submissions)
          .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.url, url)))
          .limit(1);
        return rows[0] ?? null;
      },
      async countPendingByUser(userId) {
        const rows = await db
          .select({ n: count() })
          .from(schema.submissions)
          .where(and(eq(schema.submissions.userId, userId), eq(schema.submissions.status, "submitted")));
        return rows[0]?.n ?? 0;
      },
      async listByUser(userId) {
        const subRows = await db
          .select({
            id: schema.submissions.id,
            url: schema.submissions.url,
            title: schema.submissions.title,
            status: schema.submissions.status,
            rejectedReason: schema.submissions.rejectedReason,
            createdAt: schema.submissions.createdAt,
          })
          .from(schema.submissions)
          .where(eq(schema.submissions.userId, userId))
          .orderBy(desc(schema.submissions.createdAt));
        const epRows = await db
          .select({ submissionId: schema.episodes.submissionId, status: schema.episodes.status, createdAt: schema.episodes.createdAt })
          .from(schema.episodes)
          .where(inArray(schema.episodes.submissionId, subRows.map((s) => s.id)));
        // 每投稿最新节目状态（一投稿可多期——编辑多次制作，取最新）
        const latestBySubmission = new Map<string, { status: string; createdAt: Date }>();
        for (const ep of epRows) {
          const cur = latestBySubmission.get(ep.submissionId);
          if (!cur || ep.createdAt > cur.createdAt) latestBySubmission.set(ep.submissionId, { status: ep.status, createdAt: ep.createdAt });
        }
        return subRows.map((s) => ({
          id: s.id,
          url: s.url,
          title: s.title,
          status: s.status,
          rejectedReason: s.rejectedReason,
          episodeStatus: latestBySubmission.get(s.id)?.status ?? null,
          createdAt: s.createdAt,
        }));
      },
      async listQueue(status = "submitted") {
        const rows = await db
          .select({
            id: schema.submissions.id,
            url: schema.submissions.url,
            title: schema.submissions.title,
            status: schema.submissions.status,
            createdAt: schema.submissions.createdAt,
            userEmail: schema.authUsers.email,
            displayName: schema.profiles.displayName,
            hasVoiceSample: sql<boolean>`EXISTS (
              SELECT 1 FROM ${schema.voiceSamples} vs
              WHERE vs.user_id = ${schema.submissions.userId} AND vs.status = 'ready'
            )`,
          })
          .from(schema.submissions)
          .innerJoin(schema.profiles, eq(schema.submissions.userId, schema.profiles.id))
          .innerJoin(schema.authUsers, eq(schema.profiles.id, schema.authUsers.id))
          .where(eq(schema.submissions.status, status))
          .orderBy(asc(schema.submissions.createdAt)); // inbox：先到先审
        return rows;
      },
      async getDetail(id) {
        const rows = await db
          .select({
            id: schema.submissions.id,
            userId: schema.submissions.userId,
            url: schema.submissions.url,
            title: schema.submissions.title,
            status: schema.submissions.status,
            rejectedReason: schema.submissions.rejectedReason,
            reviewedAt: schema.submissions.reviewedAt,
            createdAt: schema.submissions.createdAt,
            userEmail: schema.authUsers.email,
            displayName: schema.profiles.displayName,
          })
          .from(schema.submissions)
          .innerJoin(schema.profiles, eq(schema.submissions.userId, schema.profiles.id))
          .innerJoin(schema.authUsers, eq(schema.profiles.id, schema.authUsers.id))
          .where(eq(schema.submissions.id, id))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        const sampleRows = await db
          .select({
            audioUrl: schema.voiceSamples.audioUrl,
            transcript: schema.voiceSamples.transcript,
            language: schema.voiceSamples.language,
            status: schema.voiceSamples.status,
          })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, row.userId), eq(schema.voiceSamples.status, "ready")))
          .orderBy(desc(schema.voiceSamples.createdAt))
          .limit(1);
        return {
          id: row.id,
          userId: row.userId,
          url: row.url,
          title: row.title,
          status: row.status,
          rejectedReason: row.rejectedReason,
          reviewedAt: row.reviewedAt,
          createdAt: row.createdAt,
          userEmail: row.userEmail,
          displayName: row.displayName,
          voiceSample: sampleRows[0] ?? null,
        };
      },
      async reject(id, reason) {
        await db.update(schema.submissions)
          .set({ status: "rejected", rejectedReason: reason, reviewedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.submissions.id, id));
      },
      async markPublished(id) {
        await db.update(schema.submissions)
          .set({ status: "published", reviewedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.submissions.id, id));
      },
    },

    episodes: {
      /** 编辑一次性上传发布：slug + 期号（max+1，无空洞）+ published + isPublic，单事务 */
      async createPublished(row) {
        return db.transaction(async (tx) => {
          const [maxRow] = await tx
            .select({ max: sql<number>`COALESCE(MAX(${schema.episodes.number}), 0)` })
            .from(schema.episodes);
          const number = (maxRow?.max ?? 0) + 1;
          const inserted = await tx.insert(schema.episodes).values({
            submissionId: row.submissionId,
            userId: row.userId,
            hostId: row.hostId ?? null,
            guestId: row.guestId ?? null,
            slug: randomSlug(),
            title: row.title,
            description: row.description ?? null,
            coverUrl: row.coverUrl ?? null,
            audioUrl: row.audioUrl,
            audioSize: row.audioSize ?? null,
            durationSeconds: row.durationSeconds ?? null,
            language: row.language ?? "zh",
            tags: row.tags ?? null,
            number,
            status: "published",
            isPublic: true, // 上传即公开（公开音频端点/RSS/首页依赖此标志）
            publishedAt: new Date(),
          }).returning({ id: schema.episodes.id });
          return { id: inserted[0].id, number };
        });
      },
      async getPublicCoverKey(episodeId) {
        const rows = await db
          .select({ coverUrl: schema.episodes.coverUrl })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.id, episodeId), eq(schema.episodes.status, "published"), eq(schema.episodes.isPublic, true)))
          .limit(1);
        return rows[0]?.coverUrl ?? null;
      },
      async getPublicAudioKey(episodeId) {
        const rows = await db
          .select({ audioUrl: schema.episodes.audioUrl, publishedAt: schema.episodes.publishedAt })
          .from(schema.episodes)
          .where(and(
            eq(schema.episodes.id, episodeId),
            eq(schema.episodes.status, "published"),
            eq(schema.episodes.isPublic, true),
          ))
          .limit(1);
        const row = rows[0];
        // version = 发布时间（ETag 用——重新制作发布是新 episode，内容变化 → 浏览器重新拉取）
        return row && row.audioUrl ? { audioKey: row.audioUrl, version: (row.publishedAt ?? new Date(0)).toISOString() } : null;
      },
      async getById(id) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            submissionId: schema.episodes.submissionId,
            title: schema.episodes.title,
            description: schema.episodes.description,
            coverUrl: schema.episodes.coverUrl,
            tags: schema.episodes.tags,
            status: schema.episodes.status,
            number: schema.episodes.number,
            isPicked: schema.episodes.isPicked,
            createdAt: schema.episodes.createdAt,
            publishedAt: schema.episodes.publishedAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async updatePublished(id, row) {
        await db.update(schema.episodes)
          .set({
            ...(row.tags !== undefined ? { tags: row.tags } : {}),
            ...(row.isPicked !== undefined ? { isPicked: row.isPicked } : {}),
            ...(row.title !== undefined ? { title: row.title } : {}),
            ...(row.description !== undefined ? { description: row.description } : {}),
            ...(row.coverUrl !== undefined ? { coverUrl: row.coverUrl } : {}),
          })
          .where(eq(schema.episodes.id, id));
      },
      async listPublished() {
        return db
          .select({
            id: schema.episodes.id,
            title: schema.episodes.title,
            number: schema.episodes.number,
            isPicked: schema.episodes.isPicked,
            tags: schema.episodes.tags,
            durationSeconds: schema.episodes.durationSeconds,
            publishedAt: schema.episodes.publishedAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.status, "published"))
          .orderBy(desc(schema.episodes.number));
      },
      async listBySubmission(submissionId) {
        return db
          .select({
            id: schema.episodes.id,
            title: schema.episodes.title,
            status: schema.episodes.status,
            number: schema.episodes.number,
            isPicked: schema.episodes.isPicked,
            createdAt: schema.episodes.createdAt,
            publishedAt: schema.episodes.publishedAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.submissionId, submissionId))
          .orderBy(desc(schema.episodes.createdAt));
      },
      async getEpisodeUserId(episodeId) {
        const rows = await db
          .select({ userId: schema.episodes.userId })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.userId ?? null;
      },
      async getRole(userId) {
        const rows = await db
          .select({ role: schema.profiles.role })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        return (rows[0]?.role as "user" | "editor" | "admin" | undefined) ?? null;
      },
      async syncAdminRoles(emails) {
        if (emails.length === 0) return 0;
        const rows = await db
          .update(schema.profiles)
          .set({ role: "admin" })
          .where(and(
            inArray(schema.profiles.id, db.select({ id: schema.authUsers.id }).from(schema.authUsers).where(inArray(schema.authUsers.email, emails))),
            ne(schema.profiles.role, "admin"),
          ))
          .returning({ id: schema.profiles.id });
        return rows.length;
      },
      async getVoiceSample(userId) {
        const rows = await db
          .select({
            id: schema.voiceSamples.id,
            language: schema.voiceSamples.language,
            userId: schema.voiceSamples.userId,
            status: schema.voiceSamples.status,
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
      async getVoiceSampleByLanguage(userId, language) {
        const rows = await db
          .select({
            id: schema.voiceSamples.id,
            language: schema.voiceSamples.language,
            userId: schema.voiceSamples.userId,
            status: schema.voiceSamples.status,
            transcript: schema.voiceSamples.transcript,
            audioUrl: schema.voiceSamples.audioUrl,
            duration: schema.voiceSamples.duration,
            createdAt: schema.voiceSamples.createdAt,
          })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.language, language)))
          .limit(1);
        return rows[0] ?? null;
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
      async saveVoiceSample(row: VoiceSampleRow) {
        // 一人多语种各一条（upsert by user+language）
        await db.insert(schema.voiceSamples).values({
          userId: row.userId,
          language: row.language,
          audioUrl: row.audioUrl,
          transcript: row.transcript,
          duration: row.duration,
          status: row.status,
        }).onConflictDoUpdate({
          target: [schema.voiceSamples.userId, schema.voiceSamples.language],
          set: {
            audioUrl: row.audioUrl,
            transcript: row.transcript,
            duration: row.duration,
            status: row.status,
          },
        });
      },
      async getProfile(userId) {
        const [userRows, profileRows] = await Promise.all([
          db
            .select({ email: schema.authUsers.email, name: schema.authUsers.name, emailVerified: schema.authUsers.emailVerified, image: schema.authUsers.image })
            .from(schema.authUsers)
            .where(eq(schema.authUsers.id, userId))
            .limit(1),
          db
            .select({ username: schema.profiles.username, displayName: schema.profiles.displayName, bio: schema.profiles.bio, channelActivatedAt: schema.profiles.channelActivatedAt, persona: schema.profiles.persona })
            .from(schema.profiles)
            .where(eq(schema.profiles.id, userId))
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
          username: profile.username,
          displayName: profile.displayName,
          bio: profile.bio,
          channelActivatedAt: profile.channelActivatedAt,
          persona: profile.persona ?? null,
        };
      },
      async updatePersona(userId, persona) {
        await db.update(schema.profiles).set({ persona }).where(eq(schema.profiles.id, userId));
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
  };
}
