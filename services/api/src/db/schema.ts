import {
  boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

/** 主持人结构化人设（profiles.persona；编辑本地制作时取用，注入生成规范）。
 *  核心是性格画像（traits，如"风趣幽默、雷厉风行"）——用户指定的风格，生成时遵循；
 *  旧版细碎字段（gender/profession/age/hobbies/extra）并入 traits 自由描述，不再单列。 */
export interface HostPersona {
  /** 节目中的称呼 */
  callName?: string | null;
  gender?: string | null;
  profession?: string | null;
  age?: string | null;
  /** 性格/风格描述（自由文本；如"风趣幽默，雷厉风行，说话直来直去"）——用户指定，生成时遵循 */
  traits?: string | null;
}

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

/** better-auth emailOTP 插件：OTP 验证码存储 */
export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  /** 角色：user（投稿人）/ editor（编辑）/ admin（管理员）——编辑端点仅 editor/admin 可调用 */
  role: text("role", { enum: ["user", "editor", "admin"] }).notNull().default("user"),
  /** 频道开通时间（授权码激活；null = 未开通，不能生成/发布） */
  channelActivatedAt: timestamp("channel_activated_at", { withTimezone: true }),
  /** 主持人默认人设（编辑制作时取用） */
  persona: jsonb("persona").$type<HostPersona>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSamples = pgTable(
  "voice_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** 采样语种（zh/en/…）：一人多语种各一条；编辑按脚本语言取用 */
    language: text("language").notNull().default("zh"),
    audioUrl: text("audio_url").notNull(),
  /** 参考音频转录文本（用户朗读的固定文案；零样本克隆用） */
  transcript: text("transcript"),
  duration: integer("duration").notNull(),
  status: text("status", { enum: ["ready", "failed"] }).notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voice_samples_user_language").on(t.userId, t.language)],
);

// ---------------------------------------------------------------------------
// 投稿制（本质版）：submissions（投稿）→ episodes（成品节目）
// 用户只提交 URL + 声音采样；内容采集/脚本/语音/合成全部由编辑本地 Agent 完成，
// 成品一次性上传（音频 → R2，元数据 → episodes）。服务端无采集/LLM/TTS/合成代码。
// ---------------------------------------------------------------------------

/** 投稿：用户提交的分享链接 + 采样（采样存 voiceSamples，投稿仅关联 userId）。
 *  状态机：submitted（待审核）→ rejected（拒审，附原因）/ published（已上线）。
 *  审核与制作在编辑本地 Agent 完成，此处不承载生成中间状态。 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** 用户提交的对话分享链接（仅做合法性 + 触达性检查，不做内容采集） */
    url: text("url").notNull(),
    title: text("title"),
    status: text("status", { enum: ["submitted", "rejected", "published"] }).notNull().default("submitted"),
    /** 拒审原因（rejected 时必填，投稿人 /me/submits 可见） */
    rejectedReason: text("rejected_reason"),
    /** 编辑处理时间（reject/publish 落库） */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("submissions_user_url").on(t.userId, t.url)],
);

/** AI 平台嘉宾库：品牌声线宿主（跨期统一的 AI 受访嘉宾）。
 *  编辑本地 TTS 用 guest_voice_samples 的 referenceId/参考音频作嘉宾音色。 */
export const guests = pgTable("guests", {
  id: text("id").primaryKey(), // 用 platform 枚举值作 id（claude/chatgpt/...）
  platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "deepseek", "perplexity"] }).notNull().unique(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  intro: text("intro"),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 嘉宾音频采样（按平台 × 语种各一条）：编辑本地 TTS 的嘉宾音色来源；
 *  audio_key = storage key（R2/fs），reference_id = TTS 音色 id，
 *  transcript = 参考音频转录文本（2D references 用） */
export const guestVoiceSamples = pgTable("guest_voice_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("zh"),
  audioKey: text("audio_key").notNull(),
  referenceId: text("reference_id"),
  transcript: text("transcript"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("guest_voice_samples_guest_language_unique").on(t.guestId, t.language)]);

/** 成品节目：编辑本地制作完成后一次性上传入库，即已发布（published + isPublic）。
 *  音频在 R2（audioUrl），封面可选（coverUrl）；期号发布时 max+1 分配——"dailog 第 N 期"。 */
export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** 来源投稿（submission 删除则节目级联删除） */
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  /** 投稿人（主持人 = 自己的克隆音色） */
  userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  hostId: text("host_id").references(() => profiles.id),
  /** AI 嘉宾（品牌声线宿主，guests 表） */
  guestId: text("guest_id").references(() => guests.id),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  coverUrl: text("cover_url"),
  /** 成品音频（R2 storage key）与字节数（RSS enclosure length——Apple 要求） */
  audioUrl: text("audio_url").notNull(),
  audioSize: integer("audio_size"),
  durationSeconds: integer("duration_seconds"),
  /** 节目语言（编辑提交时判定；site 展示用） */
  language: text("language").notNull().default("zh"),
  /** 标签（编辑提交） */
  tags: text("tags").array(),
  /** 数字期号：发布时分配（max+1，唯一；无空洞）——"dailog 第 N 期" */
  number: integer("number"),
  /** 精选标记（首页播放器 / discover/picked） */
  isPicked: boolean("is_picked").notNull().default(false),
  /** 编辑上传即发布；枚举保留单值 published 兼容既有查询 */
  status: text("status", { enum: ["published"] }).notNull().default("published"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

// 消费端互动：user_id 引用 better-auth user（未登录用户不能收藏/点赞）
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

/** 站内通知（投稿状态变化：拒审/上线）——site /me/notifications 展示 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    /** 通知类型：rejected（未收录）/ published（节目上线） */
    type: text("type", { enum: ["rejected", "published"] }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** 关联链接（节目页/投稿状态页） */
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);
