import {
  boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }
export interface QualityResult { pass: boolean; reason?: string; language?: string; }

// ---------------------------------------------------------------------------
// better-auth 核心表（官方字段，profiles.id 关联 user.id；M5 迁移）
// ---------------------------------------------------------------------------

export const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  // emailAndPassword additionalFields：注册携带的邀请码
  inviteCode: text("invite_code"),
});

export const authSessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
});

export const authAccounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// 业务表（user_id 关联 better-auth user.id，text 类型；M5 迁移）
// ---------------------------------------------------------------------------

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  plan: text("plan", { enum: ["free", "pro"] }).notNull().default("free"),
  creditBalance: integer("credit_balance").notNull().default(0),
  /** 频道开通时间（授权码激活；null = 未开通，不能生成/发布） */
  channelActivatedAt: timestamp("channel_activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSamples = pgTable("voice_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  audioUrl: text("audio_url").notNull(),
  /** 训练好的音色模型 id（fish.audio model id）；为空 = 未训练，走零样本 fallback（Task 7） */
  referenceId: text("reference_id"),
  /** 参考音频转录文本（用户朗读的固定文案；references 2D 零样本克隆用，缺省占位） */
  transcript: text("transcript"),
  duration: integer("duration").notNull(),
  status: text("status", { enum: ["ready", "failed"] }).notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inviteCodes = pgTable("invite_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => authUsers.id),
  usedBy: text("used_by").references(() => authUsers.id),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  source: text("source", { enum: ["admin", "reward"] }).notNull(),
  issuedForEpisodeId: uuid("issued_for_episode_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 内容五层（快照 → 容器 → 润色脚本 → 节目 → 音轨）
// ---------------------------------------------------------------------------

/** 分享快照：分享 URL 的内容提取（全局资源，与用户无耦合；URL 唯一）。
 *  分享页是原对话的快照——内容固定、永久有效；关闭后重开 = 新 URL。
 *  status=unreachable 时 10 分钟内不重试 importer */
export const snapshots = pgTable("snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url").notNull().unique(),
  platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "deepseek", "plain"] }).notNull(),
  sourceTitle: text("source_title"),
  sourceConversationId: text("source_conversation_id"),
  /** 解析后的对话（JSONB 存库——快照内容固定，入库后不随平台变化） */
  parsedDialogue: jsonb("parsed_dialogue"),
  /** 质量分析结果：{ pass, reason?, language? }（内容固定 → 分析一次全局复用） */
  quality: jsonb("quality").$type<QualityResult>(),
  status: text("status", { enum: ["ok", "unreachable", "parse_failed"] }).notNull().default("ok"),
  lastError: text("last_error"),
  /** 触达失败时间（unreachable 后 10 分钟内不重试） */
  retryAfter: timestamp("retry_after", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 创作容器：用户 × 快照的工作区（纯容器，不含脚本内容；重复粘贴跳转已有） */
export const polishes = pgTable(
  "polishes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => snapshots.id),
    title: text("title"),
    status: text("status", { enum: ["editing", "generating", "published", "failed"] }).notNull().default("editing"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("polishes_user_snapshot").on(t.userId, t.snapshotId)],
);

/** 润色脚本：polish 可包含多个（每次润色生成一条独立记录，无版本概念） */
export const transcripts = pgTable("transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  polishId: uuid("polish_id").notNull().references(() => polishes.id, { onDelete: "cascade" }),
  segments: jsonb("segments").$type<ScriptSegment[]>().notNull(),
  language: text("language"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  /** 生成来源：润色脚本 + 容器（transcript 删除则节目级联删除） */
  transcriptId: uuid("transcript_id").notNull().references(() => transcripts.id, { onDelete: "cascade" }),
  polishId: uuid("polish_id").notNull().references(() => polishes.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  coverUrl: text("cover_url"),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  /** 无 draft 状态：创作态归 polishes；generating = 生成中 */
  status: text("status", { enum: ["generating", "published", "failed"] }).notNull().default("generating"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/** 音轨（预留）：一期节目可生成多语言音轨 */
export const tracks = pgTable("tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  language: text("language", { enum: ["zh", "en", "ja"] }).notNull(),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 消费端互动（计划 6）：user_id 引用 better-auth user（未登录用户不能收藏/点赞）
export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("favorites_user_episode").on(t.userId, t.episodeId)],
);

export const likes = pgTable(
  "likes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("likes_user_episode").on(t.userId, t.episodeId)],
);

export const generationJobs = pgTable("generation_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["queued", "tts", "merge", "upload", "done", "failed"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  stripeSessionId: text("stripe_session_id").notNull().unique(),
  amount: integer("amount").notNull(),
  episodesGranted: integer("episodes_granted").notNull(),
  status: text("status", { enum: ["succeeded", "failed"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull(),
  plan: text("plan", { enum: ["pro"] }).notNull(),
  status: text("status", { enum: ["active", "past_due", "canceled"] }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});
