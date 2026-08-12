import {
  boolean, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export interface ScriptSegment { speaker: "host" | "guest"; text: string; }

/** 主持人结构化人设（profiles.persona；生成脚本前展示/修改，注入润色提示词）。
 *  核心是性格画像（traits，如"风趣幽默、雷厉风行"）——用户指定的风格，生成时遵循；
 *  旧版细碎字段（gender/profession/age/hobbies/extra）并入 traits 自由描述，不再单列。 */
export interface HostPersona {
  /** 节目中的称呼（优先级高于 transcripts/new 的 hostName 字段） */
  callName?: string | null;
  gender?: string | null;
  profession?: string | null;
  age?: string | null;
  /** 性格/风格描述（自由文本；如"风趣幽默，雷厉风行，说话直来直去"）——用户指定，生成时遵循 */
  traits?: string | null;
}
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
  /** 角色：user（投稿人）/ editor（编辑）/ admin（管理员）——studio 管理员工作台仅 admin/editor 可登录 */
  role: text("role", { enum: ["user", "editor", "admin"] }).notNull().default("user"),
  /** 频道开通时间（授权码激活；null = 未开通，不能生成/发布） */
  channelActivatedAt: timestamp("channel_activated_at", { withTimezone: true }),
  /** 主持人默认人设（生成脚本前展示可改，仅本次生效；null = 未设置） */
  persona: jsonb("persona").$type<HostPersona>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSamples = pgTable(
  "voice_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** 采样语种（zh/en/…）：一人多语种各一条；生成时按脚本语言注入，缺语种用兜底 */
    language: text("language").notNull().default("zh"),
    audioUrl: text("audio_url").notNull(),
  /** 训练好的音色模型 id（fish.audio model id）；为空 = 未训练，走零样本 fallback（Task 7） */
  referenceId: text("reference_id"),
  /** 参考音频转录文本（用户朗读的固定文案；references 2D 零样本克隆用，缺省占位） */
  transcript: text("transcript"),
  duration: integer("duration").notNull(),
  status: text("status", { enum: ["ready", "failed"] }).notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("voice_samples_user_language").on(t.userId, t.language)],
);

// ---------------------------------------------------------------------------
// 内容五层（快照 → 容器 → 润色脚本 → 节目 → 音轨）
// ---------------------------------------------------------------------------

/** 分享快照：分享 URL 的内容提取（全局资源，与用户无耦合；URL 唯一）。
 *  分享页是原对话的快照——内容固定、永久有效；关闭后重开 = 新 URL。
 *  status=unreachable 时 10 分钟内不重试 importer */
export const snapshots = pgTable(
  "snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    url: text("url").notNull().unique(),
    platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "deepseek", "perplexity", "plain"] }).notNull(),
    sourceTitle: text("source_title"),
    sourceConversationId: text("source_conversation_id"),
    /** 解析后的对话（JSONB 存库——快照内容固定，入库后不随平台变化） */
    parsedDialogue: jsonb("parsed_dialogue"),
    /** 内容指纹：归一化消息序列的 sha256（精确重复检测；import 时计算一次） */
    fingerprint: text("fingerprint"),
    /** 内容前缀源：消息序列以本快照为前缀（衍生对话自动检测，指向被续写的源快照） */
    prefixSourceId: uuid("prefix_source_id"),
    /** 质量分析结果：{ pass, reason?, language? }（内容固定 → 分析一次全局复用） */
    quality: jsonb("quality").$type<QualityResult>(),
    status: text("status", { enum: ["ok", "unreachable", "parse_failed"] }).notNull().default("ok"),
    lastError: text("last_error"),
    /** 触达失败时间（unreachable 后 10 分钟内不重试） */
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // 自引用外键放表级定义（列级 references 会与表常量循环引用，TS 报 7022）
  (t) => [foreignKey({ columns: [t.prefixSourceId], foreignColumns: [t.id] })],
);

/** 创作容器：用户 × 快照的工作区（纯容器，不含脚本内容；重复粘贴跳转已有）。
 *  投稿制：status 同时承载投稿状态机——submitted（已投稿待审核）/ accepted（已收录）/ rejected（投稿失败）；
 *  editing/generating/published/failed 为旧自助创作模型残留（未迁移数据兼容，新流程不再产生）。 */
export const polishes = pgTable(
  "polishes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").notNull().references(() => snapshots.id),
    title: text("title"),
    status: text("status", { enum: ["editing", "generating", "published", "failed", "submitted", "accepted", "rejected"] }).notNull().default("editing"),
    /** 拒绝原因（rejected 时必填，投稿人 /me/submits 可见） */
    rejectedReason: text("rejected_reason"),
    /** 拒审来源：llm（process 质量不达标自动拒）/ editor（编辑人工拒审）；null = 旧数据 */
    reviewedBy: text("reviewed_by", { enum: ["llm", "editor"] }),
    /** 编辑处理时间（process/reject 落库） */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
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
  /** 用户修改后的脚本（保存草稿用；原始 segments 保留对比/重生成恢复） */
  updatedSegments: jsonb("updated_segments").$type<ScriptSegment[]>(),
  /** 主题名（多主题切分润色：一对话多脚本，各属一个主题；旧数据为空） */
  topic: text("topic"),
  /** 脚本标题（大模型生成，脚本列表展示） */
  title: text("title"),
  /** 创作说明（大模型生成——给创作者看：为什么生成这段脚本、主题/角度是什么） */
  creationNote: text("creation_note"),
  /** host（主持人）称呼（生成时用户输入固化；旧数据为空） */
  hostName: text("host_name"),
  /** 嘉宾引用（guests 表）+ 称呼快照（防嘉宾信息改动影响历史脚本） */
  guestId: text("guest_id").references(() => guests.id),
  guestName: text("guest_name"),
  /** 是否已生成节目（used = 已生成，一脚本一期） */
  status: text("status", { enum: ["unused", "used"] }).notNull().default("unused"),
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
  durationSeconds: integer("duration_seconds"),
  /** 来源快照（对话原文展示用——经 transcript→polish→snapshot 也可达，加直接关联省查询） */
  snapshotId: uuid("snapshot_id").references(() => snapshots.id),
  /** 字幕（程序化：脚本去情绪标签后的纯文本） */
  subtitle: text("subtitle"),
  /** 标签（大模型生成） */
  tags: text("tags").array(),
  /** 主题（脚本 topic 继承） */
  topic: text("topic"),
  hostId: text("host_id").references(() => profiles.id),
  guestId: text("guest_id").references(() => guests.id),
  /** 数字期号：发布确认时分配（max+1，唯一；未发布无编号，无空洞）——"dailog 第 N 期" */
  number: integer("number"),
  /** 精选标记（首页播放器 / discover/picked） */
  isPicked: boolean("is_picked").notNull().default(false),
  /** 生成完成待编辑确认（ready）→ 编辑确认发布（published） */
  status: text("status", { enum: ["generating", "ready", "published", "failed"] }).notNull().default("generating"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

/** AI 平台嘉宾库：我们支持的对话平台固定信息（脚本/节目引用 guestId，展示用 name/avatar/intro） */
export const guests = pgTable("guests", {
  id: text("id").primaryKey(), // 用 platform 枚举值作 id（claude/chatgpt/...）
  platform: text("platform", { enum: ["chatgpt", "claude", "kimi", "doubao", "tongyi", "gemini", "deepseek", "perplexity"] }).notNull().unique(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  intro: text("intro"),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 音轨：一期节目可生成多语言音轨（episodes.audio_url 已废弃，音频全在 tracks） */
/** 嘉宾音频采样（按平台 × 语种各一条）：生成时按 episode 语言注入同语种采样；
 *  audio_key = storage key（R2/fs），reference_id = TTS 音色 id（逐段降级路径），
 *  transcript = 参考音频转录文本（2D references 主路径用，替换采样音频时一并更新） */
export const guestVoiceSamples = pgTable("guest_voice_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  guestId: text("guest_id").notNull().references(() => guests.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("zh"),
  audioKey: text("audio_key").notNull(),
  referenceId: text("reference_id"),
  transcript: text("transcript"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("guest_voice_samples_guest_language_unique").on(t.guestId, t.language)]);

export const tracks = pgTable("tracks", {
  id: uuid("id").defaultRandom().primaryKey(),
  episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
  language: text("language", { enum: ["zh", "en", "ja"] }).notNull(),
  audioUrl: text("audio_url"),
  durationSeconds: integer("duration_seconds"),
  /** 音频字节数（RSS enclosure length——Apple 要求） */
  size: integer("size"),
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

/** 站内通知（投稿状态变化：收录/拒绝/上线）——site /me/notifications 展示 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    /** 通知类型：accepted（已收录）/ rejected（未收录）/ published（节目上线） */
    type: text("type", { enum: ["accepted", "rejected", "published"] }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** 关联链接（节目页/投稿状态页） */
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
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
