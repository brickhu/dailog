import {
  boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// better-auth 核心表（官方字段，profiles.id 关联 user.id；M5 迁移）
// ---------------------------------------------------------------------------

export const authUsers = pgTable("user", {
  id: text("id").primaryKey(),
  /** 昵称 = 主持人主页标识（@name，注册时应用层强制唯一；展示名另有 displayName 可独立） */
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /** 账号级角色：user（投稿人）/ editor（编辑）/ admin（管理员）——编辑端点仅 editor/admin 可调用 */
  role: text("role", { enum: ["user", "editor", "admin"] }).notNull().default("user"),
  /** 预留：套餐档位 / 余额（无业务逻辑，仅结构占位） */
  plan: text("plan", { enum: ["free", "pro"] }).notNull().default("free"),
  creditBalance: integer("credit_balance").notNull().default(0),
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

/** 主持人档案（1:1 关联 user；id 即用户 id）。
 *  账号级属性（role/plan/credit）在 user 表；此处只留「主持人」信息。
 *  display_name = 昵称 = 节目称呼配置源；主页标识 = user.name（@name，无独立 username）。
 *  脚本生成时把 bio/gender/profession/age/nationality 注入主持人画像（有是补充，没有也没关系）。 */
export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().references(() => authUsers.id, { onDelete: "cascade" }),
  /** 主持人展示名/昵称（节目中的称呼配置源；投稿时填充 callNameInEpisode） */
  displayName: text("display_name").notNull(),
  bio: text("bio"),
  gender: text("gender"),
  profession: text("profession"),
  age: text("age"),
  /** 国籍（脚本生成注入主持人画像） */
  nationality: text("nationality"),
  /** 社交媒体链接（自由键值对，如 {twitter, github, website}） */
  socialLinks: jsonb("social_links").$type<Record<string, string>>(),
  /** 主持人开通时间（null = 未开通，不能生成/发布） */
  channelActivatedAt: timestamp("channel_activated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const voiceSamples = pgTable(
  "voice_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** 声音归属主持人档案（profiles.id = user.id 恒等） */
    userId: text("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
    /** 采样语种（zh/en/…）：一人多语种各一条；编辑按脚本语言匹配（对应语种 → en → 唯一兜底） */
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

/** 主持人档案快照（投稿时写入 submissions.persona_info；编辑 getDetail 免查库，脚本生成注入画像） */
export interface PersonaSnapshot {
  displayName: string;
  gender: string | null;
  profession: string | null;
  age: string | null;
  bio: string | null;
  nationality: string | null;
}

// ---------------------------------------------------------------------------
// 投稿制（本质版）：submissions（投稿）→ episodes（成品节目）
// 用户只提交 URL + 声音采样；内容采集/脚本/语音/合成全部由编辑本地 Agent 完成，
// 成品一次性上传（音频 → R2，元数据 → episodes）。服务端无采集/LLM/TTS/合成代码。
// ---------------------------------------------------------------------------

/** 投稿：用户提交的分享链接 + 采样（采样存 voiceSamples，投稿仅关联 userId）。
 *  状态机：submitted（待审核）→ rejected（拒审，附原因）/ published（已上线）。
 *  审核与制作在编辑本地 Agent 完成，此处不承载生成中间状态。
 *  callNameInEpisode：本次节目的主持人自称（投稿确认页默认填 displayName，可改；
 *  脚本生成时按脚本语言改写：匹配原样/英文通用/小语种转英文）。
 *  personaInfo：投稿时对主持人档案的快照（displayName/gender/profession/age/bio/nationality），
 *  编辑 getDetail 直接用快照，免查库；voiceSampleId：投稿时使用的采样（仅记录，TTS 仍按语言匹配）。 */
export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    /** 用户提交的对话分享链接（仅做合法性 + 触达性检查，不做内容采集） */
    url: text("url").notNull(),
    /** 本次节目的主持人自称（≤20 字；脚本生成时按脚本语言改写） */
    callName: text("call_name"),
    /** 投稿人节目建议（可选；编辑脚本生成时仅供选题视角参考，无参考价值可忽略） */
    suggestion: text("suggestion"),
    /** 主持人档案快照（投稿时写入；编辑脚本生成注入画像用） */
    personaInfo: jsonb("persona_info").$type<PersonaSnapshot>(),
    /** 投稿时使用的采样（仅记录；TTS 按 脚本语言→en→兜底 重新匹配） */
    voiceSampleId: uuid("voice_sample_id").references(() => voiceSamples.id, { onDelete: "set null" }),
    title: text("title"),
    status: text("status", { enum: ["submitted", "rejected", "published"] }).notNull().default("submitted"),
    /** 拒审原因（rejected 时必填，投稿人 /me/submits 可见） */
    rejectedReason: text("rejected_reason"),
    /** 编辑处理时间（reject/publish 落库） */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // 同 URL 全局唯一（确定性 ID 同 URL 同 ID；任何人重复提交同一分享链接都拒绝）
  (t) => [uniqueIndex("submissions_url").on(t.url)],
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
/** 对话名词术语条目（Step B 配套产物 references；播放页「本期提到的名词」） */
export interface EpisodeReference {
  term: string;
  type: string;
  explanation: string;
  links: string[];
}

export const episodes = pgTable("episodes", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** 来源投稿（submission 删除则节目级联删除） */
  submissionId: uuid("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
  /** 投稿人账户（主持人 = 自己的克隆音色） */
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  /** 主持人档案（1:1 用户） */
  profileId: text("profile_id").references(() => profiles.id),
  /** AI 嘉宾（品牌声线宿主，guests 表） */
  guestId: text("guest_id").references(() => guests.id),
  slug: text("slug").notNull().unique(),
  title: text("title"),
  description: text("description"),
  /** 列表/分享用短简介（Step B 配套产物 summary） */
  summary: text("summary"),
  /** 对话名词术语条目（Step B 配套产物 references；播放页「本期提到的名词」） */
  references: jsonb("references").$type<EpisodeReference[]>().notNull().default([]),
  coverUrl: text("cover_url"),
  /** 成品音频（R2 storage key）与字节数（RSS enclosure length——Apple 要求） */
  audioUrl: text("audio_url").notNull(),
  audioSize: integer("audio_size"),
  durationSeconds: integer("duration_seconds"),
  /** 无情绪标签的完整台本（publish 时编辑上传；节目页展示用） */
  transcript: text("transcript"),
  /** 原始对话链接（publish 时服务端自动填 submission.url；节目页跳转用） */
  rawConversationUrl: text("raw_conversation_url"),
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

/** 播放/完播统计（每期一行计数；公开播放器上报，前端 session 级去重防刷）——0036 恢复展示 */
export const episodeStats = pgTable("episode_stats", {
  episodeId: uuid("episode_id").primaryKey().references(() => episodes.id, { onDelete: "cascade" }),
  plays: integer("plays").notNull().default(0),
  completions: integer("completions").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 消费端互动：收藏已并入默认播放列表（0033，playlist_episodes + playlists.is_default）；
// 点赞保留独立表（情感互动，与收藏不重叠）。user_id 引用 better-auth user（未登录不能点赞）。
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

/** 播放列表（内容类型）：把不同节目打包成有序列表。
 *  kind=platform：平台策展（编辑/管理员创建，is_picked 精选标记，首页/发现页列表区露出）；
 *  kind=user：仅每用户唯一的默认收藏清单（is_default=true + ownerId=用户，强制私有）——
 *  收藏 = 以 owner_id 标识的清单（Spotify「Liked Songs」式），不分类/不重排/不公开分享。
 *  封面 MVP 自动取首期节目封面（coverUrl 字段预留自定义，不新增 R2 路径）。 */
export const playlists = pgTable("playlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** 公开页 URL 标识（/playlist/<slug>） */
  slug: text("slug").notNull().unique(),
  /** 列表类型：platform（平台策展）/ user（用户自建） */
  kind: text("kind", { enum: ["platform", "user"] }).notNull().default("platform"),
  /** 创建者（平台列表 = 编辑/管理员账号；用户列表 = 用户本人） */
  ownerId: text("owner_id").references(() => authUsers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  /** 列表封面（预留：MVP 自动取首期节目封面） */
  coverUrl: text("cover_url"),
  language: text("language").notNull().default("zh"),
  /** 公开状态：平台列表恒公开；用户列表 false = 私有（仅自己可见） */
  isPublic: boolean("is_public").notNull().default(true),
  /** 平台精选标记（首页/发现页列表区优先露出） */
  isPicked: boolean("is_picked").notNull().default(false),
  /** 系统内置默认列表（Spotify「Liked Songs」式，0033 引入 / 0035 恢复）：每个用户一个「我的收藏」，
   *  强制私有、不可编辑/删除/重排；收藏按钮（/v1/me/favorites*）直接读写该列表 */
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 播放列表条目（有序集合）：position 显式排序；唯一 (playlist_id, episode_id) 防重复收录；
 *  删列表/删节目均级联清理（onDelete cascade）。 */
export const playlistEpisodes = pgTable(
  "playlist_episodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    playlistId: uuid("playlist_id").notNull().references(() => playlists.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playlist_episodes_playlist_episode_unique").on(t.playlistId, t.episodeId),
    index("playlist_episodes_playlist_position_idx").on(t.playlistId, t.position),
    index("playlist_episodes_episode_idx").on(t.episodeId),
  ],
);

/** 站内通知（投稿状态变化：拒审/上线）——site /me/notifications 展示 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    /** 通知类型：rejected（未收录）/ published（节目上线）/ unpublished（下线申请通过）/ unpublish_rejected（下线申请未通过） */
    type: text("type", { enum: ["rejected", "published", "unpublished", "unpublish_rejected"] }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** 关联链接（节目页/投稿状态页） */
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);

/** 节目下线申请（用户「申请下线」→ 编辑审批）：平台保留内容策展权，用户不能自助下架。
 *  审批通过 → episodes.isPublic=false + 通知投稿人；拒绝 → 通知投稿人。 */
export const episodeRemovalRequests = pgTable(
  "episode_removal_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** 目标节目（删节目级联删申请） */
    episodeId: uuid("episode_id").notNull().references(() => episodes.id, { onDelete: "cascade" }),
    /** 申请人（= 节目归属投稿人；删账号级联删申请） */
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    /** 申请理由（选填，≤500 字符——编辑审批参考） */
    reason: text("reason"),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    /** 处理编辑（editor/admin 账号 id） */
    handledBy: text("handled_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("episode_removal_requests_episode_idx").on(t.episodeId), index("episode_removal_requests_status_idx").on(t.status, t.createdAt)],
);
