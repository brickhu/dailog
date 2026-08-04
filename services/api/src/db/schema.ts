import {
  boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

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

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "deepseek", "plain"] }).notNull(),
    sourceTitle: text("source_title"),
    sourceConversationId: text("source_conversation_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    // 原始对话/解析后对话存 R2（imports/{id}.dialogue.json，见 dialogue-store.ts）——meta 留库
    status: text("status", { enum: ["parsed", "failed"] }).notNull().default("parsed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("imports_user_platform_conv").on(t.userId, t.platform, t.sourceConversationId)],
);

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  /** 来源导入（imports.parsed_dialogue 是润色/质量门的对话来源） */
  importId: uuid("import_id").references(() => imports.id),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  coverUrl: text("cover_url"),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  status: text("status", { enum: ["draft", "generating", "published", "failed"] }).notNull().default("draft"),
  qualityStatus: text("quality_status", { enum: ["pending", "passed", "rejected"] }).notNull().default("pending"),
  qualityReason: text("quality_reason"),
  /** 对话级润色上限计数：仅统计 LLM 润色保存（savePolished），手动保存（PUT script）不计 */
  polishCount: integer("polish_count").notNull().default(0),
  language: text("language"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
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

export const scripts = pgTable("scripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  segments: jsonb("segments").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
