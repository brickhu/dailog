import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomBytes } from "node:crypto";
import * as schema from "../db/schema";
import type { PersonaSnapshot } from "../db/schema";
import type { VoiceSampleRow } from "../routes/voice";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505";
}

function randomSlug(): string {
  return randomBytes(8).toString("hex");
}

// ---------------------------------------------------------------------------
// 投稿（本质版）：用户提交 URL + 采样 → submitted；编辑本地制作后 reject / markPublished
// ---------------------------------------------------------------------------

export interface SubmissionsRepo {
  /** 投稿入库（唯一约束 url 全局唯一；重复提交由路由层查 findById/findByUrl）。
   *  callNameInEpisode：本次节目称呼（可为 null，脚本生成时按脚本语言改写）；
   *  personaInfo：主持人档案快照（路由层从 getPersonaSnapshot 取，编辑侧免查库）；
   *  voiceSampleId：投稿时使用的采样（仅记录，TTS 仍按语言匹配）；
   *  suggestion：投稿人节目建议（可为 null；编辑生成脚本时仅供选题视角参考） */
  create(id: string, userId: string, url: string, title: string | null, suggestion?: string | null, guest?: { id: string; name: string; intro?: string | null } | null, host?: { callName: string | null; personaInfo: PersonaSnapshot | null; voiceSampleId: string | null } | null): Promise<{ id: string }>;
  /** 重复投稿检测（URL 全局唯一：任何人提交过同一分享链接都算重复） */
  findByUrl(url: string): Promise<{ id: string; status: string } | null>;
  /** 按确定性投稿 ID 查（主键索引；同 URL 同 ID → 已存在即重复，含他人投稿） */
  findById(id: string): Promise<{ id: string; status: string } | null>;
  /** 待审核投稿数（status=submitted）——投稿并发限制（pending_limit）用 */
  countPendingByUser(userId: string): Promise<number>;
  /** 声音采样严格要求：投稿必须关联一条属于该用户的 ready 采样。
   *  sampleId 给定时 → 校验该采样属于该用户且 ready（防引用他人采样）；
   *  未给定时 → 用户须至少拥有一条 ready 采样（任意语种）。 */
  hasReadyVoiceSample(userId: string, sampleId?: string | null): Promise<boolean>;
  /** 我的投稿列表（submitted/rejected/published + 最新节目状态 + 本次称呼）；按投稿时间倒序 */
  listByUser(userId: string): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    callName: string | null;
    status: string;
    rejectedReason: string | null;
    episodeStatus: string | null;
    createdAt: Date;
  }>>;
  /** 投稿公开详情（无归属校验；公开页用，不含个人敏感字段）+ 最新节目信息 */
  getPublicById(id: string): Promise<{
    id: string;
    url: string;
    title: string | null;
    status: string;
    createdAt: Date;
    episode: { id: string; slug: string; title: string | null; number: number | null; coverUrl: string | null; status: string } | null;
  } | null>;
  /** 当前用户单条投稿详情（归属校验：非本人返回 null）+ 最新节目信息 */
  getByUser(userId: string, id: string): Promise<{
    id: string;
    url: string;
    title: string | null;
    callName: string | null;
    status: string;
    rejectedReason: string | null;
    createdAt: Date;
    episode: { id: string; slug: string; title: string | null; number: number | null; coverUrl: string | null; status: string } | null;
  } | null>;
  /** 编辑队列：按状态筛选（缺省 submitted），submitted 按提交时间升序（inbox 先到先审）。
   *  附带投稿人信息与采样就绪标记（无采样 = 无法制作主持人克隆音色，先标注） */
  listQueue(status?: "submitted" | "collected" | "rejected" | "published" | "crafted"): Promise<Array<{
    id: string;
    url: string;
    title: string | null;
    status: string;
    createdAt: Date;
    userEmail: string;
    displayName: string;
    hasVoiceSample: boolean;
  }>>;
  /** 编辑详情（无归属校验）：投稿 + 主持人档案快照 + 采样（TTS 按 脚本语言→en→唯一 匹配） */
  getDetail(id: string): Promise<{
    id: string;
    userId: string;
    url: string;
    title: string | null;
    /** 采集状态：-1 失败 / 0 未采集 / 1 成功 */
    collected: number;
    /** 采集统计（消息数/各角色轮数/字数） */
    dialogueCount: { messages: number; userTurns: number; assistantTurns: number; chars: number } | null;
    status: string;
    rejectedReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    userEmail: string;
    /** 主持人档案快照（投稿时写入；脚本生成注入画像用） */
    personaInfo: {
      displayName: string;
      gender: string | null;
      profession: string | null;
      age: string | null;
      bio: string | null;
      nationality: string | null;
    } | null;
    /** 投稿时配置的本次节目称呼（脚本生成时按脚本语言改写：匹配原样/英文通用/小语种转英文） */
    callName: string | null;
    /** 投稿人节目建议（可选；脚本生成时仅供选题视角参考，无参考价值可忽略） */
    suggestion: string | null;
    /** 投稿时使用的采样（仅记录） */
    voiceSampleId: string | null;
    /** 投稿人全部 ready 采样（按语种；编辑端展示 + 服务端 TTS 按规则匹配） */
    voiceSamples: Array<{ audioUrl: string; transcript: string | null; language: string; status: string; duration: number | null }>;
  } | null>;
  /** 拒审（reason 必填） */
  reject(id: string, reason: string): Promise<void>;
  /** 编辑已上传成品 → published */
  markPublished(id: string): Promise<void>;
  /** 补录主持人称呼（callName）：投稿缺称呼时编辑确认后写入；不存在返回 null */
  setCallName(id: string, callName: string): Promise<{ id: string } | null>;
  /** 更新投稿标题（采集提取 / 审核生成；submissions.title 权威，投稿列表/详情展示） */
  setTitle(id: string, title: string | null): Promise<{ id: string } | null>;
  /** 创作审核决策（rejected=true → review_status=rejected；通过 → 不写 approved，仅记 score） */
  setReview(id: string, review: { rejected: boolean; score: number | null }): Promise<{ id: string } | null>;
  /** 设置投稿主状态（crafted = 节目音频已生成上传，未发布） */
  setStatus(id: string, status: "submitted" | "collected" | "rejected" | "published" | "crafted"): Promise<{ id: string } | null>;
  /** 采集状态：-1=采集失败 / 0=未采集 / 1=采集成功（R2 key 由 URL 哈希推导，不存库） */
  /** 采集状态写入（-1 失败 / 0 未采集 / 1 成功）——联动投稿主状态：1→collected、-1→rejected（附原因）、0→submitted */
  setCollected(id: string, collected: number, reason?: string | null): Promise<{ id: string } | null>;
  /** 采集统计写入（消息数/各角色轮数/字数） */
  setDialogueCount(id: string, stats: { messages: number; userTurns: number; assistantTurns: number; chars: number }): Promise<{ id: string } | null>;
}

// ---------------------------------------------------------------------------
// 节目（成品）：编辑一次性上传即发布（期号 max+1）
// ---------------------------------------------------------------------------

export interface EpisodeCreateRow {
  submissionId: string;
  userId: string;
  /** 主持人档案（1:1 用户；publish 时由路由层传 userId） */
  profileId?: string | null;
  guestId?: string | null;
  title: string | null;
  description?: string | null;
  /** 列表/分享短简介（Step B summary） */
  summary?: string | null;
  /** 对话名词术语条目（Step B references） */
  references?: schema.EpisodeReference[] | null;
  /** 金句（Step B highlights；详情页「本期金句」） */
  highlights?: schema.EpisodeHighlight[] | null;
  coverUrl?: string | null;
  /** R2 storage key（编辑上传的成品音频） */
  audioUrl: string;
  audioSize?: number | null;
  durationSeconds?: number | null;
  language?: string;
  tags?: string[] | null;
  /** 分类 token（insight/experience/advice/inspiration） */
  category?: string | null;
  /** 无情绪标签的完整台本（节目页展示用） */
  transcript?: string | null;
  /** 原始对话链接（服务端自动填 submission.url） */
  rawConversationUrl?: string | null;
}

export interface EpisodesRepo {
  /** 编辑一次性上传发布：slug + 期号（max+1，事务）+ published + isPublic，单事务 */
  createPublished(row: EpisodeCreateRow): Promise<{ id: string; number: number; slug: string }>;
  /** 公开读封面（主站免鉴权端点用）：仅已发布且公开 */
  getPublicCoverKey(episodeId: string): Promise<string | null>;
  /** 公开读音频（主站免鉴权端点用）：仅已发布且公开；
   *  version = 发布时间（ETag 用） */
  getPublicAudioKey(episodeId: string): Promise<{ audioKey: string; version: string } | null>;
  /** 公开详情（按 slug 或 id 查，仅已发布且公开）：详情页 SSR head OG 用——
   *  sourceUrl = 原始对话链接（回退投稿 url），含主持人名/称呼/台本；
   *  含本期嘉宾（guests 表，无嘉宾 → null）与主持人头像——详情页 cast 卡片用 */
  getPublicEpisode(idOrSlug: string): Promise<{
    id: string;
    slug: string;
    number: number | null;
    title: string | null;
    description: string | null;
    /** Step B summary：列表/分享短简介（SQL 已 select，类型此前漏声明） */
    summary: string | null;
    /** Step B references：对话名词术语条目（SQL 已 select，类型此前漏声明） */
    references: schema.EpisodeReference[];
    /** Step B highlights：本期金句（纯文本展示） */
    highlights: schema.EpisodeHighlight[];
    durationSeconds: number | null;
    publishedAt: Date | null;
    coverUrl: string | null;
    language: string;
    audioUrl: string | null;
    tags: string[] | null;
    sourceUrl: string | null;
    transcript: string | null;
    username: string;
    displayName: string;
    /** 主持人头像（authUsers.image；cast 卡片用） */
    hostAvatar: string | null;
    callName: string | null;
    /** 本期 AI 嘉宾（无 → null；cast 卡片用） */
    guest: {
      id: string;
      platform: string;
      name: string;
      avatar: string | null;
      intro: string | null;
      url: string | null;
    } | null;
  } | null>;
  /** 播放/完播计数 +1（upsert；公开播放器上报）——0036 恢复 */
  recordStat(episodeId: string, type: "play" | "completion"): Promise<void>;
  /** 公开读取播放/完播/点赞统计（未统计过 → 0；like 计数实时 COUNT）——0036 恢复 */
  getStats(episodeId: string): Promise<{ plays: number; completions: number; likes: number }>;
  /** 站点头部数据（公开）：主播数/嘉宾数/节目期数/最热主播——首页宣传语用 */
  getSiteStats(): Promise<{ hostCount: number; guestCount: number; episodeCount: number; topHost: string | null; topHostAvatar: string | null; topTags: string[] }>;
  /** 热门主播（公开）：按期数排序（0034 起不含播放统计；个人主页入口展示） */
  listTopHosts(limit?: number): Promise<Array<{
    username: string;
    displayName: string;
    avatar: string | null;
    episodeCount: number;
  }>>;
  /** 推荐队列（公开）：新鲜度 + 精选 + 语言偏好排序（0034 起不含播放统计）；exclude 排除已看 */
  listRecommended(opts?: { lang?: string; limit?: number; exclude?: string[] }): Promise<Array<{
    id: string;
    slug: string;
    title: string | null;
    description: string | null;
    coverUrl: string | null;
    language: string;
    audioUrl: string;
    durationSeconds: number | null;
    publishedAt: Date | null;
    isPicked: boolean;
    username: string;
    displayName: string;
    callName: string | null;
  }>>;
  /** 编辑端节目详情（无归属校验）——含 userId（republish 拼 R2 key 用） */
  getById(id: string): Promise<{
    id: string;
    submissionId: string;
    userId: string;
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
  /** 已发布节目编辑：tags / 精选标记 / 元数据 / 公开状态（编辑端下架/恢复——内容策展权在平台） */
  updatePublished(id: string, row: { tags?: string[] | null; isPicked?: boolean; title?: string | null; description?: string | null; coverUrl?: string | null; isPublic?: boolean }): Promise<void>;
  /** 重新生成已发布节目：全量替换内容字段（保留 id/slug/期号/统计/精选/公开状态），
   *  publishedAt 刷新为 now（列表新鲜度 + ETag 版本变化——客户端重新拉取新音频）。
   *  只更新显式提供的字段；undefined 字段保留旧值。 */
  updateEpisodeContent(id: string, row: {
    title?: string | null;
    description?: string | null;
    summary?: string | null;
    references?: schema.EpisodeReference[] | null;
    highlights?: schema.EpisodeHighlight[] | null;
    coverUrl?: string | null;
    audioUrl?: string;
    audioSize?: number | null;
    durationSeconds?: number | null;
    language?: string;
    tags?: string[] | null;
    category?: string | null;
    transcript?: string | null;
    guestId?: string | null;
  }): Promise<void>;
  /** 已发布节目清单（编辑端）：按期号倒序 */
  listPublished(): Promise<Array<{
    id: string;
    slug: string;
    title: string | null;
    number: number | null;
    status: string;
    isPublic: boolean;
    isPicked: boolean;
    tags: string[] | null;
    durationSeconds: number | null;
    publishedAt: Date | null;
  }>>;
  /** 嘉宾参与的公开节目（嘉宾详情页）：按发布时间倒序，带主持人名 */
  listByGuest(guestId: string): Promise<Array<{
    id: string;
    slug: string;
    title: string | null;
    coverUrl: string | null;
    durationSeconds: number | null;
    publishedAt: Date | null;
    username: string;
    displayName: string | null;
  }>>;
  /** 按投稿列节目（编辑端详情用，无归属校验；含 slug/coverUrl——重复投稿提示已生成节目用） */
  listBySubmission(submissionId: string): Promise<Array<{
    id: string;
    slug: string;
    title: string | null;
    coverUrl: string | null;
    status: string;
    isPublic: boolean;
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
  /** 用户自己的节目（/me/episodes）：按 user_id 全量（含已下架 isPublic=false），发布时间倒序；
   *  附封面与最近一次下线申请状态（前端展示申请进度） */
  listByUser(userId: string): Promise<Array<{
    id: string;
    slug: string;
    title: string | null;
    coverUrl: string | null;
    number: number | null;
    durationSeconds: number | null;
    publishedAt: Date | null;
    isPublic: boolean;
    isPicked: boolean;
    removalRequest: { status: "pending" | "approved" | "rejected" } | null;
  }>>;
  /** 申请下线前置校验：节目归属 + 当前公开状态（不存在 → null） */
  getRemovalTarget(episodeId: string): Promise<{ userId: string; isPublic: boolean } | null>;
  /** 提交下线申请（用户侧）：该节目已有 pending 申请 → null（不重复提交） */
  createRemovalRequest(episodeId: string, userId: string, reason: string | null): Promise<{ id: string } | null>;
  /** 下线申请队列（编辑端）：按状态列出，附节目与投稿人信息，提交时间倒序 */
  listRemovalRequests(status: "pending" | "approved" | "rejected"): Promise<RemovalRequestRow[]>;
  /** 审批下线申请（编辑端）：置状态 + handledBy/At；返回目标节目 + 申请人（通知用）；不存在/已处理 → null */
  resolveRemovalRequest(id: string, action: "approved" | "rejected", handledBy: string): Promise<{ episodeId: string; userId: string } | null>;
  // ---- 声音采样（voice 路由沿用） ----
  getVoiceSample(userId: string): Promise<VoiceSampleRow | null>;
  /** 按语种取采样（编辑本地 TTS 按脚本语言取用）；无该语种 → null（调用方用兜底） */
  getVoiceSampleByLanguage(userId: string, language: string): Promise<VoiceSampleRow | null>;
  getVoiceSampleKey(userId: string): Promise<string | null>;
  saveVoiceSample(row: VoiceSampleRow): Promise<{ id: string }>;
  // ---- 账号/档案（/api/me/profile） ----
  /** 账号 + 主持人档案——昵称对外叫 nickname（列 user.name，= @slug） */
  getProfile(userId: string): Promise<{
    email: string | null;
    nickname: string | null;
    emailVerified: boolean;
    image: string | null;
    displayName: string | null;
    bio: string | null;
    gender: string | null;
    profession: string | null;
    age: string | null;
    nationality: string | null;
    socialLinks: Record<string, string> | null;
    channelActivatedAt: Date | null;
  } | null>;
  updateUserNickname(userId: string, nickname: string): Promise<void>;
  /** 主持人档案快照（投稿时写入 submissions.persona_info；编辑 getDetail 免查库） */
  getPersonaSnapshot(userId: string): Promise<PersonaSnapshot | null>;
  /** 主持人档案设置（displayName/bio/gender/profession/age/nationality/socialLinks） */
  updateChannel(userId: string, row: { displayName?: string; bio?: string | null; gender?: string | null; profession?: string | null; age?: string | null; nationality?: string | null; socialLinks?: Record<string, string> | null }): Promise<{ ok: true }>;
}

// ---------------------------------------------------------------------------
// 播放列表（内容类型）：把不同节目打包成有序列表。
//  kind=platform（平台策展，编辑/管理员创建，isPicked 精选，公开索引露出）
//  kind=user 仅保留每用户唯一的默认收藏清单（is_default=true + ownerId=用户，强制私有）——
//  收藏 = 以 owner_id 标识的清单（Spotify「Liked Songs」式）：不分类/不重排/不公开分享，
//  聚合展示（按标签/语言/嘉宾分组）由前端现算，存储层零分类。
//  封面 MVP 自动取首期公开节目封面（coverUrl 预留自定义）。
// ---------------------------------------------------------------------------

export interface PlaylistRow {
  id: string;
  slug: string;
  kind: "platform" | "user";
  ownerId: string | null;
  title: string;
  description: string | null;
  coverUrl: string | null;
  language: string;
  isPublic: boolean;
  isPicked: boolean;
  /** 系统内置默认列表（每个用户一个「我的收藏」；强制私有、不可编辑/删除/重排） */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaylistEpisodeRow {
  position: number;
  episodeId: string;
  slug: string;
  title: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  language: string;
  audioUrl: string;
  username: string;
  displayName: string;
  callName: string | null;
}

/** 我的收藏条目（默认列表 + 分组字段：tags/language/guestName 供前端自动聚合） */
export interface FavoriteEpisodeRow {
  position: number;
  episodeId: string;
  slug: string;
  title: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
  language: string;
  audioUrl: string;
  username: string;
  displayName: string;
  callName: string | null;
  /** 嘉宾名（guests.name；无嘉宾 → null）——「按嘉宾」分组 */
  guestName: string | null;
  /** 标签（episodes.tags；无 → null）——「按标签」分组 */
  tags: string[] | null;
}

export interface PlaylistsRepo {
  /** 创建列表（slug 随机 hex，与节目 slug 同风格） */
  create(row: {
    kind: "platform" | "user";
    ownerId: string | null;
    title: string;
    description?: string | null;
    language?: string;
    isPublic?: boolean;
    isPicked?: boolean;
  }): Promise<{ id: string; slug: string }>;
  /** 公开列表索引（平台策展为主：kind=platform + isPublic）。
   *  lang 可选（"zh"|"en"）：**同语言列表优先**（ORDER BY 匹配降序），数量不足时按
   *  isPicked/updated 自然回退到其他语言（与节目推荐的语言偏好分流同模式）。
   *  附带公开节目数、首期公开节目封面与首期节目 id（封面 MVP 自动取首期——按 id 拼公开封面 URL）。 */
  listPublic(opts?: { lang?: string; limit?: number }): Promise<Array<PlaylistRow & { episodeCount: number; firstCover: string | null; firstEpisodeId: string | null }>>;
  /** 编辑端清单：全部平台列表（含 is_public=false 草稿态；isPicked 优先、更新倒序） */
  listEditor(opts?: { limit?: number }): Promise<Array<PlaylistRow & { episodeCount: number; firstCover: string | null; firstEpisodeId: string | null }>>;
  /** 公开详情（含节目列表，仅公开节目按 position 排序）；不存在/未公开 → null */
  getPublicBySlug(slug: string): Promise<(PlaylistRow & { episodes: PlaylistEpisodeRow[] }) | null>;
  /** 单查（路由层归属/存在校验用；不校验公开性） */
  getById(id: string): Promise<PlaylistRow | null>;
  /** 我的收藏（默认列表全部节目，position 倒序=新加入在前；含分组字段）——/v1/me/favorites */
  listFavorites(userId: string): Promise<FavoriteEpisodeRow[]>;
  /** 是否已收藏（默认列表包含该节目；节目须已发布公开） */
  isFavorite(userId: string, episodeId: string): Promise<boolean>;
  /** 收藏：自动建默认列表后加入（已存在 → added=false 幂等） */
  addFavorite(userId: string, episodeId: string): Promise<{ added: boolean }>;
  /** 取消收藏（不存在静默） */
  removeFavorite(userId: string, episodeId: string): Promise<void>;
  /** 更新元信息（title/description/isPublic/isPicked/language/coverUrl）——归属校验由路由层做 */
  update(id: string, row: { title?: string; description?: string | null; isPublic?: boolean; isPicked?: boolean; language?: string; coverUrl?: string | null }): Promise<void>;
  /** 公开读列表封面（公开播放列表的 cover_url；不存在/未公开 → null）——公开封面端点用 */
  getPublicCover(playlistId: string): Promise<string | null>;
  /** 用户默认列表（「我的收藏」）：不存在则创建（kind=user + is_default + 强制私有）——每个用户自动拥有 */
  getOrCreateDefault(userId: string): Promise<{ id: string }>;
  /** 删除列表（级联清条目） */
  remove(id: string): Promise<void>;
  /** 列表节目（含 position；publicOnly=true 只留已发布公开节目——私有列表归属人可见全部） */
  listEpisodes(playlistId: string, opts?: { publicOnly?: boolean }): Promise<PlaylistEpisodeRow[]>;
  /** 添加节目（position = max+1 追加末尾；已存在 → added=false 幂等） */
  addEpisode(playlistId: string, episodeId: string): Promise<{ added: boolean }>;
  /** 移除节目（不存在静默） */
  removeEpisode(playlistId: string, episodeId: string): Promise<void>;
  /** 重排（事务：按数组顺序重写 position；数组中未出现的既有条目保留在末尾） */
  reorder(playlistId: string, orderedEpisodeIds: string[]): Promise<void>;
  /** 节目收录于哪些公开列表（节目页「收录于」反查） */
  listByEpisode(episodeId: string): Promise<Array<{ id: string; slug: string; title: string }>>;
}

/** 节目下线申请队列条目（编辑端） */
export interface RemovalRequestRow {
  id: string;
  episodeId: string;
  slug: string;
  episodeTitle: string | null;
  episodeNumber: number | null;
  /** 申请人 = 节目归属投稿人 */
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
}

export interface GuestVoiceSampleRow {
  id: string;
  guestId: string;
  language: string;
  audioKey: string;
  transcript: string | null;
}

export interface GuestsRepo {
  getByPlatform(platform: string): Promise<{ id: string; name: string; intro: string | null } | null>;
  list(): Promise<{ id: string; platform: string; name: string; avatar: string | null; intro: string | null; url: string | null }[]>;
  /** 嘉宾详情（按 id = platform 值，公开详情页用） */
  getById(id: string): Promise<{ id: string; platform: string; name: string; avatar: string | null; intro: string | null; url: string | null } | null>;
  /** 嘉宾音频采样：按语种取（TTS 同语种优先注入）；无该语种 → null（调用方按 en 兜底） */
  voiceSampleByLanguage(guestId: string, language: string): Promise<GuestVoiceSampleRow | null>;
  /** 任意语种采样（/v1/editor/samples/guest/:id/audio 参考音频下载用，无语言参数） */
  voiceSampleAny(guestId: string): Promise<GuestVoiceSampleRow | null>;
  /** 系统内任意嘉宾可用音色（TTS 兜底：目标嘉宾无声线时用其他嘉宾音色替换——替换音色、不替换嘉宾名字；
   *  excludeGuestId 排除目标嘉宾，避免自兜底） */
  anyVoiceSampleByLanguage(language: string, excludeGuestId?: string): Promise<GuestVoiceSampleRow | null>;
  /** 管理录入/更新（guest_id + language 唯一，upsert） */
  upsertVoiceSample(row: { guestId: string; language: string; audioKey: string; transcript?: string | null }): Promise<void>;
  /** 更新嘉宾称呼/简介（guests 表——节目中的称呼服务端配置） */
  update(id: string, row: { name?: string; intro?: string | null }): Promise<void>;
  /** 管理列表（join guests 展示名） */
  listVoiceSamples(): Promise<{
    id: string;
    guestId: string;
    guestName: string;
    language: string;
    audioKey: string;
    transcript: string | null;
  }[]>;
}

export interface NotificationsRepo {
  /** 创建站内通知（拒审 / 上线 / 下线审批结果） */
  create(row: { userId: string; type: "rejected" | "published" | "unpublished" | "unpublish_rejected"; title: string; body?: string | null; link?: string | null }): Promise<void>;
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
  playlists: PlaylistsRepo;
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
          .select({ id: schema.guests.id, name: schema.guests.name, intro: schema.guests.intro })
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
      async getById(id) {
        const rows = await db
          .select({ id: schema.guests.id, platform: schema.guests.platform, name: schema.guests.name, avatar: schema.guests.avatar, intro: schema.guests.intro, url: schema.guests.url })
          .from(schema.guests)
          .where(eq(schema.guests.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async voiceSampleByLanguage(guestId, language) {
        const rows = await db
          .select({
            id: schema.guestVoiceSamples.id,
            guestId: schema.guestVoiceSamples.guestId,
            language: schema.guestVoiceSamples.language,
            audioKey: schema.guestVoiceSamples.audioKey,
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
            transcript: schema.guestVoiceSamples.transcript,
          })
          .from(schema.guestVoiceSamples)
          .where(eq(schema.guestVoiceSamples.guestId, guestId))
          .orderBy(desc(schema.guestVoiceSamples.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },
      async anyVoiceSampleByLanguage(language, excludeGuestId) {
        const rows = await db
          .select({
            id: schema.guestVoiceSamples.id,
            guestId: schema.guestVoiceSamples.guestId,
            language: schema.guestVoiceSamples.language,
            audioKey: schema.guestVoiceSamples.audioKey,
            transcript: schema.guestVoiceSamples.transcript,
          })
          .from(schema.guestVoiceSamples)
          .where(and(
            eq(schema.guestVoiceSamples.language, language),
            excludeGuestId ? ne(schema.guestVoiceSamples.guestId, excludeGuestId) : undefined,
          ))
          .orderBy(desc(schema.guestVoiceSamples.createdAt))
          .limit(1);
        return rows[0] ?? null;
      },
      async upsertVoiceSample(row) {
        await db.insert(schema.guestVoiceSamples).values({
          guestId: row.guestId,
          language: row.language,
          audioKey: row.audioKey,
          transcript: row.transcript ?? null,
        }).onConflictDoUpdate({
          target: [schema.guestVoiceSamples.guestId, schema.guestVoiceSamples.language],
          set: {
            audioKey: row.audioKey,
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
            transcript: schema.guestVoiceSamples.transcript,
          })
          .from(schema.guestVoiceSamples)
          .innerJoin(schema.guests, eq(schema.guests.id, schema.guestVoiceSamples.guestId))
          .orderBy(schema.guests.platform);
      },
    },

    submissions: {
      /** 投稿入库（唯一约束 user×url 兜底；重复提交由路由层查 existing） */
      async create(id, userId, url, title, suggestion, guest = null, host = null) {
        try {
          const rows = await db.insert(schema.submissions).values({
            id,
            userId,
            url,
            title: title ?? null,
            suggestion: suggestion ?? null,
            host: host ?? null,
            guest: guest ?? null,
            status: "submitted",
          }).returning({ id: schema.submissions.id });
          return { id: rows[0].id };
        } catch (err) {
          if (isUniqueViolation(err)) return { id: "" }; // 竞态：并发提交撞唯一约束
          throw err;
        }
      },
      async findById(id) {
        const rows = await db
          .select({ id: schema.submissions.id, status: schema.submissions.status })
          .from(schema.submissions)
          .where(eq(schema.submissions.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      async findByUrl(url) {
        const rows = await db
          .select({ id: schema.submissions.id, status: schema.submissions.status })
          .from(schema.submissions)
          .where(eq(schema.submissions.url, url))
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
      /** 声音采样严格要求（投稿前置校验）——sampleId 给定须归属且 ready；否则须有任意 ready 采样 */
      async hasReadyVoiceSample(userId, sampleId) {
        const cond = sampleId
          ? and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.id, sampleId), eq(schema.voiceSamples.status, "ready"))
          : and(eq(schema.voiceSamples.userId, userId), eq(schema.voiceSamples.status, "ready"));
        const rows = await db
          .select({ id: schema.voiceSamples.id })
          .from(schema.voiceSamples)
          .where(cond)
          .limit(1);
        return rows.length > 0;
      },
      async listByUser(userId) {
        const subRows = await db
          .select({
            id: schema.submissions.id,
            url: schema.submissions.url,
            title: schema.submissions.title,
            collected: schema.submissions.collected,
            dialogueCount: schema.submissions.dialogueCount,
            callName: sql<string>`${schema.submissions.host}->>'callName'`,
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
          callName: s.callName,
          status: s.status,
          rejectedReason: s.rejectedReason,
          episodeStatus: latestBySubmission.get(s.id)?.status ?? null,
          createdAt: s.createdAt,
        }));
      },
      async getPublicById(id) {
        const [sub] = await db
          .select({
            id: schema.submissions.id,
            url: schema.submissions.url,
            title: schema.submissions.title,
            collected: schema.submissions.collected,
            dialogueCount: schema.submissions.dialogueCount,
            status: schema.submissions.status,
            createdAt: schema.submissions.createdAt,
          })
          .from(schema.submissions)
          .where(eq(schema.submissions.id, id))
          .limit(1);
        if (!sub) return null;
        const epRows = await db
          .select({
            id: schema.episodes.id,
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            number: schema.episodes.number,
            coverUrl: schema.episodes.coverUrl,
            status: schema.episodes.status,
            createdAt: schema.episodes.createdAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.submissionId, id))
          .orderBy(desc(schema.episodes.createdAt))
          .limit(1);
        const ep = epRows[0] ?? null;
        return {
          id: sub.id,
          url: sub.url,
          title: sub.title,
          status: sub.status,
          createdAt: sub.createdAt,
          episode: ep ? { id: ep.id, slug: ep.slug, title: ep.title, number: ep.number, coverUrl: ep.coverUrl, status: ep.status } : null,
        };
      },
      async getByUser(userId, id) {
        const [sub] = await db
          .select({
            id: schema.submissions.id,
            url: schema.submissions.url,
            title: schema.submissions.title,
            callName: sql<string>`${schema.submissions.host}->>'callName'`,
            status: schema.submissions.status,
            rejectedReason: schema.submissions.rejectedReason,
            createdAt: schema.submissions.createdAt,
          })
          .from(schema.submissions)
          .where(and(eq(schema.submissions.id, id), eq(schema.submissions.userId, userId)))
          .limit(1);
        if (!sub) return null;
        const epRows = await db
          .select({
            id: schema.episodes.id,
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            number: schema.episodes.number,
            coverUrl: schema.episodes.coverUrl,
            status: schema.episodes.status,
            createdAt: schema.episodes.createdAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.submissionId, id))
          .orderBy(desc(schema.episodes.createdAt))
          .limit(1);
        const ep = epRows[0] ?? null;
        return {
          id: sub.id,
          url: sub.url,
          title: sub.title,
          callName: sub.callName,
          status: sub.status,
          rejectedReason: sub.rejectedReason,
          createdAt: sub.createdAt,
          episode: ep ? { id: ep.id, slug: ep.slug, title: ep.title, number: ep.number, coverUrl: ep.coverUrl, status: ep.status } : null,
        };
      },
      async listQueue(status = "submitted") {
        const rows = await db
          .select({
            id: schema.submissions.id,
            url: schema.submissions.url,
            title: schema.submissions.title,
            collected: schema.submissions.collected,
            dialogueCount: schema.submissions.dialogueCount,
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
          .innerJoin(schema.authUsers, eq(schema.submissions.userId, schema.authUsers.id))
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.authUsers.id))
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
            collected: schema.submissions.collected,
            dialogueCount: schema.submissions.dialogueCount,
            suggestion: schema.submissions.suggestion,
            status: schema.submissions.status,
            rejectedReason: schema.submissions.rejectedReason,
            reviewedAt: schema.submissions.reviewedAt,
            reviewStatus: schema.submissions.reviewStatus,
            reviewScore: schema.submissions.reviewScore,
            createdAt: schema.submissions.createdAt,
            userEmail: schema.authUsers.email,
            host: schema.submissions.host,
            guest: schema.submissions.guest,
          })
          .from(schema.submissions)
          .innerJoin(schema.authUsers, eq(schema.submissions.userId, schema.authUsers.id))
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
            duration: schema.voiceSamples.duration,
          })
          .from(schema.voiceSamples)
          .where(and(eq(schema.voiceSamples.userId, row.userId), eq(schema.voiceSamples.status, "ready")))
          .orderBy(desc(schema.voiceSamples.createdAt)); // 最近优先（编辑 TTS 兜底取第一条）
        return {
          id: row.id,
          userId: row.userId,
          url: row.url,
          title: row.title,
          collected: row.collected,
          dialogueCount: row.dialogueCount,
          status: row.status,
          rejectedReason: row.rejectedReason,
          reviewedAt: row.reviewedAt,
          reviewStatus: row.reviewStatus as "approved" | "rejected" | null,
          reviewScore: row.reviewScore as number | null,
          createdAt: row.createdAt,
          userEmail: row.userEmail,
          personaInfo: (row.host && row.host.personaInfo) || null,
          callName: (row.host && row.host.callName) || null,
          suggestion: row.suggestion,
          voiceSampleId: (row.host && row.host.voiceSampleId) || null,
          voiceSamples: sampleRows,
          host: row.host as { callName: string | null; personaInfo: PersonaSnapshot | null } | null,
          guest: row.guest as { id: string; name: string; intro?: string | null } | null,
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
      /** 补录主持人称呼（callName）：投稿缺称呼（detail 显示「主持人称呼：无」）时编辑确认后写入——
       *  持久化到投稿，避免每次重新生成回退「主持人」（2026-08-28 实例：挂谷猜想一期 call_name 为空） */
      async setCallName(id: string, callName: string) {
        const rows = await db.update(schema.submissions)
          .set({ host: sql`jsonb_set(COALESCE(host, '{}'::jsonb), '{callName}', to_jsonb(${callName})::jsonb)`, updatedAt: new Date() })
          .where(eq(schema.submissions.id, id))
          .returning({ id: schema.submissions.id });
        return rows[0]?.id ? { id: rows[0].id } : null;
      },
      /** 采集状态写入（-1 失败 / 0 未采集 / 1 成功）——联动投稿主状态：1→collected、-1→rejected（附原因）、0→submitted */
      async setCollected(id: string, collected: number, reason?: string | null) {
        const rows = await db.update(schema.submissions)
          .set({
            collected,
            status: collected === 1 ? "collected" : collected === -1 ? "rejected" : "submitted",
            ...(collected === -1 ? { rejectedReason: reason || "采集失败" } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.submissions.id, id))
          .returning({ id: schema.submissions.id });
        return rows[0]?.id ? { id: rows[0].id } : null;
      },
      /** 采集统计写入 */
      async setDialogueCount(id: string, stats: { messages: number; userTurns: number; assistantTurns: number; chars: number }) {
        const rows = await db.update(schema.submissions)
          .set({ dialogueCount: stats, updatedAt: new Date() })
          .where(eq(schema.submissions.id, id))
          .returning({ id: schema.submissions.id });
        return rows[0]?.id ? { id: rows[0].id } : null;
      },
      /** 更新投稿标题（≤200 字） */
      async setTitle(id: string, title: string | null) {
        const rows = await db.update(schema.submissions)
          .set({ title, updatedAt: new Date() })
          .where(eq(schema.submissions.id, id))
          .returning({ id: schema.submissions.id });
        return rows[0]?.id ? { id: rows[0].id } : null;
      },
      /** 创作审核决策写入（rejected=true → review_status=rejected；通过 → 不写 approved，仅记 score） */
      async setReview(id: string, review: { rejected: boolean; score: number | null }) {
        const rows = await db.update(schema.submissions)
          .set({ reviewStatus: review.rejected ? "rejected" : null, reviewScore: review.score, updatedAt: new Date() })
          .where(eq(schema.submissions.id, id))
          .returning({ id: schema.submissions.id });
        return rows[0]?.id ? { id: rows[0].id } : null;
      },
      /** 设置投稿主状态（crafted：节目音频已生成并上传 R2，未发布） */
      async setStatus(id: string, status: "submitted" | "collected" | "rejected" | "published" | "crafted") {
        const rows = await db.update(schema.submissions)
          .set({ status, updatedAt: new Date() })
          .where(eq(schema.submissions.id, id))
          .returning({ id: schema.submissions.id });
        return rows[0]?.id ? { id: rows[0].id } : null;
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
            profileId: row.profileId ?? null,
            guestId: row.guestId ?? null,
            slug: randomSlug(),
            title: row.title,
            description: row.description ?? null,
            summary: row.summary ?? null,
            references: row.references ?? [],
            highlights: row.highlights ?? [],
            coverUrl: row.coverUrl ?? null,
            audioUrl: row.audioUrl,
            audioSize: row.audioSize ?? null,
            durationSeconds: row.durationSeconds ?? null,
            language: row.language ?? "zh",
            tags: row.tags ?? null,
            category: row.category ?? null,
            transcript: row.transcript ?? null,
            rawConversationUrl: row.rawConversationUrl ?? null,
            number,
            status: "published",
            isPublic: true, // 上传即公开（公开音频端点/RSS/首页依赖此标志）
            publishedAt: new Date(),
          }).returning({ id: schema.episodes.id, slug: schema.episodes.slug });
          return { id: inserted[0].id, number, slug: inserted[0].slug };
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
      /** 公开详情（详情页 SSR OG 用）：先按 slug，命中即返回；
       *  旧 /episode/<uuid> 链接再按 id（uuid 列——非 uuid 输入直接跳过，避免 22P02） */
      async getPublicEpisode(idOrSlug) {
        const fields = {
          id: schema.episodes.id,
          slug: schema.episodes.slug,
          number: schema.episodes.number,
          title: schema.episodes.title,
          description: schema.episodes.description,
          summary: schema.episodes.summary,
          references: schema.episodes.references,
          highlights: schema.episodes.highlights,
          durationSeconds: schema.episodes.durationSeconds,
          publishedAt: schema.episodes.publishedAt,
          coverUrl: schema.episodes.coverUrl,
          language: schema.episodes.language,
          audioUrl: schema.episodes.audioUrl,
          tags: schema.episodes.tags,
          category: schema.episodes.category,
          transcript: schema.episodes.transcript,
          sourceUrl: sql<string>`COALESCE(${schema.episodes.rawConversationUrl}, ${schema.submissions.url})`,
          username: schema.authUsers.name,
          displayName: schema.profiles.displayName,
          hostAvatar: schema.authUsers.image,
          callName: sql<string>`${schema.submissions.host}->>'callName'`,
          // 本期嘉宾（LEFT JOIN：无嘉宾 → 行内各列全 null，下方归一为 guest: null）
          guest: {
            id: schema.guests.id,
            platform: schema.guests.platform,
            name: schema.guests.name,
            avatar: schema.guests.avatar,
            intro: schema.guests.intro,
            url: schema.guests.url,
          },
        };
        const base = () => db.select(fields)
          .from(schema.episodes)
          .innerJoin(schema.submissions, eq(schema.submissions.id, schema.episodes.submissionId))
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.episodes.userId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.profiles.id))
          .leftJoin(schema.guests, eq(schema.guests.id, schema.episodes.guestId));
        const norm = <T extends { guest: { id: string | null } | null }>(row: T): T =>
          row.guest?.id ? row : { ...row, guest: null };
        const bySlug = await base().where(and(
          eq(schema.episodes.status, "published"),
          eq(schema.episodes.isPublic, true),
          eq(schema.episodes.slug, idOrSlug),
        )).limit(1);
        if (bySlug.length) return norm(bySlug[0]);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)) return null;
        const byId = await base().where(and(
          eq(schema.episodes.status, "published"),
          eq(schema.episodes.isPublic, true),
          eq(schema.episodes.id, idOrSlug),
        )).limit(1);
        return byId[0] ? norm(byId[0]) : null;
      },
      /** 播放/完播计数 +1（upsert 行；仅已发布公开节目——调用方先校验存在）——0036 恢复 */
      async recordStat(episodeId, type: "play" | "completion") {
        await db.insert(schema.episodeStats).values({
          episodeId,
          plays: type === "play" ? 1 : 0,
          completions: type === "completion" ? 1 : 0,
        }).onConflictDoUpdate({
          target: schema.episodeStats.episodeId,
          set: {
            plays: type === "play" ? sql`${schema.episodeStats.plays} + 1` : schema.episodeStats.plays,
            completions: type === "completion" ? sql`${schema.episodeStats.completions} + 1` : schema.episodeStats.completions,
            updatedAt: new Date(),
          },
        });
      },
      /** 公开读取播放/完播/点赞统计（未统计过 → 0）——0036 恢复 */
      async getStats(episodeId) {
        const [stats, like] = await Promise.all([
          db
            .select({ plays: schema.episodeStats.plays, completions: schema.episodeStats.completions })
            .from(schema.episodeStats)
            .where(eq(schema.episodeStats.episodeId, episodeId))
            .limit(1),
          db.select({ n: count() }).from(schema.likes).where(eq(schema.likes.episodeId, episodeId)),
        ]);
        return {
          plays: stats[0]?.plays ?? 0,
          completions: stats[0]?.completions ?? 0,
          likes: like[0]?.n ?? 0,
        };
      },
      /** 站点头部数据：主播/嘉宾/节目计数 + 最热主播 */
      async getSiteStats() {
        const [epCount, hostCount, guestCount] = await Promise.all([
          db.select({ n: count() }).from(schema.episodes)
            .where(and(eq(schema.episodes.status, "published"), eq(schema.episodes.isPublic, true))),
          db.select({ n: sql<number>`count(DISTINCT ${schema.episodes.userId})::int` }).from(schema.episodes)
            .where(and(eq(schema.episodes.status, "published"), eq(schema.episodes.isPublic, true))),
          db.select({ n: count() }).from(schema.guests),
        ]);
        const top = (await this.listTopHosts(1))[0] ?? null;
        // 节目标签聚合（内容量小，JS 聚合取高频前 5）
        const tagRows = await db
          .select({ tags: schema.episodes.tags })
          .from(schema.episodes)
          .where(and(eq(schema.episodes.status, "published"), eq(schema.episodes.isPublic, true)));
        const freq = new Map<string, number>();
        for (const r of tagRows) {
          for (const tag of r.tags ?? []) freq.set(tag, (freq.get(tag) ?? 0) + 1);
        }
        const topTags = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
        return {
          hostCount: hostCount[0]?.n ?? 0,
          guestCount: guestCount[0]?.n ?? 0,
          episodeCount: epCount[0]?.n ?? 0,
          topHost: top?.displayName ?? null,
          topHostAvatar: top?.avatar ?? null,
          topTags,
        };
      },
      /** 热门主播：按期数排序（0034 起不含播放统计） */
      async listTopHosts(limit = 8) {
        const rows = await db
          .select({
            username: schema.authUsers.name,
            displayName: schema.profiles.displayName,
            avatar: schema.authUsers.image,
            episodeCount: sql<number>`count(DISTINCT ${schema.episodes.id})::int`,
          })
          .from(schema.episodes)
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.episodes.userId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.profiles.id))
          .where(and(eq(schema.episodes.status, "published"), eq(schema.episodes.isPublic, true)))
          .groupBy(schema.authUsers.name, schema.profiles.displayName, schema.authUsers.image)
          .orderBy(desc(sql`count(DISTINCT ${schema.episodes.id})`))
          .limit(Math.min(limit, 20));
        return rows;
      },
      /** 推荐队列（抖音流/首页播放器用）：新鲜度 + 精选 + 语言偏好 加权（0034 起不含播放统计）。
       *  lang 匹配加分（不足时自然 fallback 其他语言）；exclude 排除已播/已看节目。 */
      async listRecommended(opts: { lang?: string; limit?: number; exclude?: string[] } = {}) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            description: schema.episodes.description,
            coverUrl: schema.episodes.coverUrl,
            language: schema.episodes.language,
            audioUrl: schema.episodes.audioUrl,
            durationSeconds: schema.episodes.durationSeconds,
            publishedAt: schema.episodes.publishedAt,
            isPicked: schema.episodes.isPicked,
            username: schema.authUsers.name,
            displayName: schema.profiles.displayName,
            callName: sql<string>`${schema.submissions.host}->>'callName'`,
          })
          .from(schema.episodes)
          .innerJoin(schema.submissions, eq(schema.submissions.id, schema.episodes.submissionId))
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.episodes.userId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.profiles.id))
          .where(and(
            eq(schema.episodes.status, "published"),
            eq(schema.episodes.isPublic, true),
            opts.exclude && opts.exclude.length > 0
              ? sql`${schema.episodes.id} NOT IN (${sql.join(opts.exclude.map((id) => sql`${id}::uuid`), sql`, `)})`
              : undefined,
          ));
        const lang = opts.lang ?? null;
        const now = Date.now();
        const scored = rows
          .map((r) => {
            // 热度分（0034 简化）：新鲜度为主 + 精选加权 + 语言偏好（播放/完播统计已移除）
            const days = Math.max(0, (now - (r.publishedAt ?? new Date(0)).getTime()) / 86_400_000);
            const recency = 1 / (1 + days / 30);
            const langBoost = lang && r.language === lang ? 0.3 : 0;
            const score = recency * 0.6 + (r.isPicked ? 0.2 : 0) + langBoost;
            return { ...r, score };
          })
          .sort((a, b) => b.score - a.score);
        const limit = opts.limit ?? 20;
        return scored.slice(0, limit).map(({ score, ...ep }) => ep);
      },
      async getById(id) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            submissionId: schema.episodes.submissionId,
            userId: schema.episodes.userId,
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
            ...(row.isPublic !== undefined ? { isPublic: row.isPublic } : {}),
          })
          .where(eq(schema.episodes.id, id));
      },
      async updateEpisodeContent(id, row) {
        await db.update(schema.episodes)
          .set({
            ...(row.title !== undefined ? { title: row.title } : {}),
            ...(row.description !== undefined ? { description: row.description } : {}),
            ...(row.summary !== undefined ? { summary: row.summary } : {}),
            // jsonb 列不接受 null（schema 默认 []）——null 归一为 []，undefined 跳过（保留旧值）
            ...(row.references !== undefined ? { references: row.references ?? [] } : {}),
            ...(row.highlights !== undefined ? { highlights: row.highlights ?? [] } : {}),
            ...(row.coverUrl !== undefined ? { coverUrl: row.coverUrl } : {}),
            ...(row.audioUrl !== undefined ? { audioUrl: row.audioUrl } : {}),
            ...(row.audioSize !== undefined ? { audioSize: row.audioSize } : {}),
            ...(row.durationSeconds !== undefined ? { durationSeconds: row.durationSeconds } : {}),
            ...(row.language !== undefined ? { language: row.language } : {}),
            ...(row.tags !== undefined ? { tags: row.tags } : {}),
            ...(row.category !== undefined ? { category: row.category } : {}),
            ...(row.transcript !== undefined ? { transcript: row.transcript } : {}),
            ...(row.guestId !== undefined ? { guestId: row.guestId } : {}),
            publishedAt: new Date(), // 重新生成：publishedAt 刷新（列表新鲜度 + ETag 版本变化）
          })
          .where(eq(schema.episodes.id, id));
      },
      async listPublished() {
        return db
          .select({
            id: schema.episodes.id,
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            number: schema.episodes.number,
            status: schema.episodes.status,
            isPublic: schema.episodes.isPublic,
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
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            coverUrl: schema.episodes.coverUrl,
            status: schema.episodes.status,
            isPublic: schema.episodes.isPublic,
            number: schema.episodes.number,
            isPicked: schema.episodes.isPicked,
            createdAt: schema.episodes.createdAt,
            publishedAt: schema.episodes.publishedAt,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.submissionId, submissionId))
          .orderBy(desc(schema.episodes.createdAt));
      },
      async listByGuest(guestId) {
        return db
          .select({
            id: schema.episodes.id,
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            coverUrl: schema.episodes.coverUrl,
            durationSeconds: schema.episodes.durationSeconds,
            publishedAt: schema.episodes.publishedAt,
            username: schema.authUsers.name,
            displayName: schema.profiles.displayName,
          })
          .from(schema.episodes)
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.episodes.userId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.profiles.id))
          .where(and(
            eq(schema.episodes.guestId, guestId),
            eq(schema.episodes.status, "published"),
            eq(schema.episodes.isPublic, true),
          ))
          .orderBy(desc(schema.episodes.publishedAt));
      },
      async getEpisodeUserId(episodeId) {
        const rows = await db
          .select({ userId: schema.episodes.userId })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0]?.userId ?? null;
      },
      async listByUser(userId) {
        const rows = await db
          .select({
            id: schema.episodes.id,
            slug: schema.episodes.slug,
            title: schema.episodes.title,
            coverUrl: schema.episodes.coverUrl,
            number: schema.episodes.number,
            durationSeconds: schema.episodes.durationSeconds,
            publishedAt: schema.episodes.publishedAt,
            isPublic: schema.episodes.isPublic,
            isPicked: schema.episodes.isPicked,
          })
          .from(schema.episodes)
          .where(eq(schema.episodes.userId, userId))
          .orderBy(desc(schema.episodes.publishedAt));
        if (rows.length === 0) return rows.map((r) => ({ ...r, removalRequest: null }));
        // 每个节目最近一次下线申请（最新一条；有 pending 即未处理）
        const reqs = await db
          .select({
            episodeId: schema.episodeRemovalRequests.episodeId,
            status: schema.episodeRemovalRequests.status,
            createdAt: schema.episodeRemovalRequests.createdAt,
          })
          .from(schema.episodeRemovalRequests)
          .where(inArray(schema.episodeRemovalRequests.episodeId, rows.map((r) => r.id)))
          .orderBy(desc(schema.episodeRemovalRequests.createdAt));
        const latest = new Map<string, { status: "pending" | "approved" | "rejected" }>();
        for (const req of reqs) {
          if (!latest.has(req.episodeId)) latest.set(req.episodeId, { status: req.status });
        }
        return rows.map((r) => ({ ...r, removalRequest: latest.get(r.id) ?? null }));
      },
      async getRemovalTarget(episodeId) {
        const rows = await db
          .select({ userId: schema.episodes.userId, isPublic: schema.episodes.isPublic })
          .from(schema.episodes)
          .where(eq(schema.episodes.id, episodeId))
          .limit(1);
        return rows[0] ?? null;
      },
      async createRemovalRequest(episodeId, userId, reason) {
        const pending = await db
          .select({ id: schema.episodeRemovalRequests.id })
          .from(schema.episodeRemovalRequests)
          .where(and(
            eq(schema.episodeRemovalRequests.episodeId, episodeId),
            eq(schema.episodeRemovalRequests.userId, userId),
            eq(schema.episodeRemovalRequests.status, "pending"),
          ))
          .limit(1);
        if (pending.length > 0) return null;
        const rows = await db
          .insert(schema.episodeRemovalRequests)
          .values({ episodeId, userId, reason: reason ?? null })
          .returning({ id: schema.episodeRemovalRequests.id });
        return rows[0] ?? null;
      },
      async listRemovalRequests(status) {
        return db
          .select({
            id: schema.episodeRemovalRequests.id,
            episodeId: schema.episodeRemovalRequests.episodeId,
            slug: schema.episodes.slug,
            episodeTitle: schema.episodes.title,
            episodeNumber: schema.episodes.number,
            userId: schema.episodeRemovalRequests.userId,
            userEmail: schema.authUsers.email,
            userDisplayName: schema.profiles.displayName,
            reason: schema.episodeRemovalRequests.reason,
            status: schema.episodeRemovalRequests.status,
            createdAt: schema.episodeRemovalRequests.createdAt,
          })
          .from(schema.episodeRemovalRequests)
          .innerJoin(schema.episodes, eq(schema.episodes.id, schema.episodeRemovalRequests.episodeId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.episodeRemovalRequests.userId))
          .leftJoin(schema.profiles, eq(schema.profiles.id, schema.episodeRemovalRequests.userId))
          .where(eq(schema.episodeRemovalRequests.status, status))
          .orderBy(desc(schema.episodeRemovalRequests.createdAt))
          .limit(100);
      },
      async resolveRemovalRequest(id, action, handledBy) {
        const rows = await db
          .update(schema.episodeRemovalRequests)
          .set({ status: action, handledAt: new Date(), handledBy })
          .where(and(eq(schema.episodeRemovalRequests.id, id), eq(schema.episodeRemovalRequests.status, "pending")))
          .returning({ episodeId: schema.episodeRemovalRequests.episodeId, userId: schema.episodeRemovalRequests.userId });
        if (rows.length === 0) return null;
        return rows[0];
      },
      async getRole(userId) {
        const rows = await db
          .select({ role: schema.authUsers.role })
          .from(schema.authUsers)
          .where(eq(schema.authUsers.id, userId))
          .limit(1);
        return (rows[0]?.role as "user" | "editor" | "admin" | undefined) ?? null;
      },
      async syncAdminRoles(emails) {
        if (emails.length === 0) return 0;
        const rows = await db
          .update(schema.authUsers)
          .set({ role: "admin" })
          .where(and(
            inArray(schema.authUsers.email, emails),
            ne(schema.authUsers.role, "admin"),
          ))
          .returning({ id: schema.authUsers.id });
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
      async saveVoiceSample(row: VoiceSampleRow): Promise<{ id: string }> {
        // 一人多语种各一条（upsert by user+language）；返回 id（投稿时记录 voiceSampleId 用）
        const rows = await db.insert(schema.voiceSamples).values({
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
        }).returning({ id: schema.voiceSamples.id });
        return { id: rows[0]?.id ?? "" };
      },
      async getProfile(userId) {
        const [userRows, profileRows] = await Promise.all([
          db
            .select({ email: schema.authUsers.email, name: schema.authUsers.name, emailVerified: schema.authUsers.emailVerified, image: schema.authUsers.image })
            .from(schema.authUsers)
            .where(eq(schema.authUsers.id, userId))
            .limit(1),
          db
            .select({
              displayName: schema.profiles.displayName,
              bio: schema.profiles.bio,
              gender: schema.profiles.gender,
              profession: schema.profiles.profession,
              age: schema.profiles.age,
              nationality: schema.profiles.nationality,
              socialLinks: schema.profiles.socialLinks,
              channelActivatedAt: schema.profiles.channelActivatedAt,
            })
            .from(schema.profiles)
            .where(eq(schema.profiles.id, userId))
            .limit(1),
        ]);
        const user = userRows[0];
        const profile = profileRows[0];
        if (!user || !profile) return null;
        return {
          email: user.email,
          nickname: user.name, // 对外契约 nickname = @slug；DB 列 user.name 是 better-auth 标准字段
          emailVerified: user.emailVerified,
          image: user.image,
          displayName: profile.displayName,
          bio: profile.bio,
          gender: profile.gender,
          profession: profile.profession,
          age: profile.age,
          nationality: profile.nationality,
          socialLinks: profile.socialLinks ?? null,
          channelActivatedAt: profile.channelActivatedAt,
        };
      },
      /** 主持人档案快照（投稿时写入 submissions.persona_info；编辑 getDetail 免查库） */
      async getPersonaSnapshot(userId) {
        const rows = await db
          .select({
            displayName: schema.profiles.displayName,
            bio: schema.profiles.bio,
            gender: schema.profiles.gender,
            profession: schema.profiles.profession,
            age: schema.profiles.age,
            nationality: schema.profiles.nationality,
          })
          .from(schema.profiles)
          .where(eq(schema.profiles.id, userId))
          .limit(1);
        const p = rows[0];
        if (!p) return null;
        return {
          displayName: p.displayName,
          gender: p.gender,
          profession: p.profession,
          age: p.age,
          bio: p.bio,
          nationality: p.nationality,
        };
      },
      async updateUserNickname(userId, nickname) {
        await db.update(schema.authUsers).set({ name: nickname, updatedAt: new Date() }).where(eq(schema.authUsers.id, userId));
      },
      async updateChannel(userId, row) {
        await db.update(schema.profiles)
          .set({
            ...(row.displayName !== undefined ? { displayName: row.displayName } : {}),
            ...(row.bio !== undefined ? { bio: row.bio } : {}),
            ...(row.gender !== undefined ? { gender: row.gender } : {}),
            ...(row.profession !== undefined ? { profession: row.profession } : {}),
            ...(row.age !== undefined ? { age: row.age } : {}),
            ...(row.nationality !== undefined ? { nationality: row.nationality } : {}),
            ...(row.socialLinks !== undefined ? { socialLinks: row.socialLinks } : {}),
          })
          .where(eq(schema.profiles.id, userId));
        return { ok: true };
      },
    },

    playlists: {
      /** 创建列表（slug 随机 hex，与节目 slug 同风格） */
      async create(row) {
        const inserted = await db.insert(schema.playlists).values({
          slug: randomSlug(),
          kind: row.kind,
          ownerId: row.ownerId ?? null,
          title: row.title,
          description: row.description ?? null,
          coverUrl: null,
          language: row.language ?? "zh",
          isPublic: row.isPublic ?? true,
          isPicked: row.isPicked ?? false,
        }).returning({ id: schema.playlists.id, slug: schema.playlists.slug });
        return { id: inserted[0].id, slug: inserted[0].slug };
      },
      /** 公开列表索引（平台策展：kind=platform + isPublic；精选优先、更新倒序） */
      async listPublic(opts: { lang?: string; limit?: number } = {}) {
        const limit = Math.min(opts.limit ?? 20, 50);
        return db.select({
          id: schema.playlists.id,
          slug: schema.playlists.slug,
          kind: schema.playlists.kind,
          ownerId: schema.playlists.ownerId,
          title: schema.playlists.title,
          description: schema.playlists.description,
          coverUrl: schema.playlists.coverUrl,
          language: schema.playlists.language,
          isPublic: schema.playlists.isPublic,
          isPicked: schema.playlists.isPicked,
          isDefault: schema.playlists.isDefault,
          createdAt: schema.playlists.createdAt,
          updatedAt: schema.playlists.updatedAt,
          episodeCount: sql<number>`(
            SELECT count(*)::int FROM ${schema.playlistEpisodes} pe
            JOIN ${schema.episodes} e ON e.id = pe.episode_id
            WHERE pe.playlist_id = ${schema.playlists}."id"
              AND e.status = 'published' AND e.is_public = true
          )`,
          firstCover: sql<string | null>`(
            SELECT e.cover_url FROM ${schema.playlistEpisodes} pe
            JOIN ${schema.episodes} e ON e.id = pe.episode_id
            WHERE pe.playlist_id = ${schema.playlists}."id"
              AND e.status = 'published' AND e.is_public = true
              AND e.cover_url IS NOT NULL
            ORDER BY pe.position LIMIT 1
          )`,
          firstEpisodeId: sql<string | null>`(
            SELECT e.id FROM ${schema.playlistEpisodes} pe
            JOIN ${schema.episodes} e ON e.id = pe.episode_id
            WHERE pe.playlist_id = ${schema.playlists}."id"
              AND e.status = 'published' AND e.is_public = true
            ORDER BY pe.position LIMIT 1
          )`,
        })
          .from(schema.playlists)
          .where(and(eq(schema.playlists.kind, "platform"), eq(schema.playlists.isPublic, true)))
          .orderBy(
            ...(opts.lang ? [sql`(${schema.playlists.language} = ${opts.lang}) DESC`] : []),
            desc(schema.playlists.isPicked),
            desc(schema.playlists.updatedAt),
          )
          .limit(limit);
      },
      /** 编辑端清单：全部平台列表（含未公开草稿态） */
      async listEditor(opts = {}) {
        const limit = Math.min(opts.limit ?? 100, 200);
        return db.select({
          id: schema.playlists.id,
          slug: schema.playlists.slug,
          kind: schema.playlists.kind,
          ownerId: schema.playlists.ownerId,
          title: schema.playlists.title,
          description: schema.playlists.description,
          coverUrl: schema.playlists.coverUrl,
          language: schema.playlists.language,
          isPublic: schema.playlists.isPublic,
          isPicked: schema.playlists.isPicked,
          isDefault: schema.playlists.isDefault,
          createdAt: schema.playlists.createdAt,
          updatedAt: schema.playlists.updatedAt,
          episodeCount: sql<number>`(
            SELECT count(*)::int FROM ${schema.playlistEpisodes} pe
            WHERE pe.playlist_id = ${schema.playlists}."id"
          )`,
          firstCover: sql<string | null>`(
            SELECT e.cover_url FROM ${schema.playlistEpisodes} pe
            JOIN ${schema.episodes} e ON e.id = pe.episode_id
            WHERE pe.playlist_id = ${schema.playlists}."id"
              AND e.cover_url IS NOT NULL
            ORDER BY pe.position LIMIT 1
          )`,
          firstEpisodeId: sql<string | null>`(
            SELECT e.id FROM ${schema.playlistEpisodes} pe
            JOIN ${schema.episodes} e ON e.id = pe.episode_id
            WHERE pe.playlist_id = ${schema.playlists}."id"
            ORDER BY pe.position LIMIT 1
          )`,
        })
          .from(schema.playlists)
          .where(eq(schema.playlists.kind, "platform"))
          .orderBy(desc(schema.playlists.isPicked), desc(schema.playlists.updatedAt))
          .limit(limit);
      },
      /** 公开详情（含节目，仅公开节目按 position 排序）；不存在/未公开 → null */
      async getPublicBySlug(slug) {
        const rows = await db
          .select({
            id: schema.playlists.id,
            slug: schema.playlists.slug,
            kind: schema.playlists.kind,
            ownerId: schema.playlists.ownerId,
            title: schema.playlists.title,
            description: schema.playlists.description,
            coverUrl: schema.playlists.coverUrl,
            language: schema.playlists.language,
            isPublic: schema.playlists.isPublic,
            isPicked: schema.playlists.isPicked,
            isDefault: schema.playlists.isDefault,
            createdAt: schema.playlists.createdAt,
            updatedAt: schema.playlists.updatedAt,
          })
          .from(schema.playlists)
          .where(and(eq(schema.playlists.slug, slug), eq(schema.playlists.isPublic, true)))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        const episodes = await this.listEpisodes(row.id, { publicOnly: true });
        return { ...row, episodes };
      },
      async getById(id) {
        const rows = await db
          .select({
            id: schema.playlists.id,
            slug: schema.playlists.slug,
            kind: schema.playlists.kind,
            ownerId: schema.playlists.ownerId,
            title: schema.playlists.title,
            description: schema.playlists.description,
            coverUrl: schema.playlists.coverUrl,
            language: schema.playlists.language,
            isPublic: schema.playlists.isPublic,
            isPicked: schema.playlists.isPicked,
            isDefault: schema.playlists.isDefault,
            createdAt: schema.playlists.createdAt,
            updatedAt: schema.playlists.updatedAt,
          })
          .from(schema.playlists)
          .where(eq(schema.playlists.id, id))
          .limit(1);
        return rows[0] ?? null;
      },
      /** 我的收藏（默认列表全部节目；position 倒序 = 新加入在前；含分组字段） */
      async listFavorites(userId) {
        const { id } = await this.getOrCreateDefault(userId);
        return db.select({
          position: schema.playlistEpisodes.position,
          episodeId: schema.episodes.id,
          slug: schema.episodes.slug,
          title: schema.episodes.title,
          coverUrl: schema.episodes.coverUrl,
          durationSeconds: schema.episodes.durationSeconds,
          publishedAt: schema.episodes.publishedAt,
          language: schema.episodes.language,
          audioUrl: schema.episodes.audioUrl,
          username: schema.authUsers.name,
          displayName: schema.profiles.displayName,
          callName: sql<string>`${schema.submissions.host}->>'callName'`,
          guestName: schema.guests.name,
          tags: schema.episodes.tags,
        })
          .from(schema.playlistEpisodes)
          .innerJoin(schema.episodes, eq(schema.episodes.id, schema.playlistEpisodes.episodeId))
          .innerJoin(schema.submissions, eq(schema.submissions.id, schema.episodes.submissionId))
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.episodes.userId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.profiles.id))
          .leftJoin(schema.guests, eq(schema.guests.id, schema.episodes.guestId))
          .where(eq(schema.playlistEpisodes.playlistId, id))
          .orderBy(desc(schema.playlistEpisodes.position));
      },
      /** 是否已收藏（默认列表包含该节目） */
      async isFavorite(userId, episodeId) {
        const { id } = await this.getOrCreateDefault(userId);
        const rows = await db
          .select({ id: schema.playlistEpisodes.id })
          .from(schema.playlistEpisodes)
          .where(and(
            eq(schema.playlistEpisodes.playlistId, id),
            eq(schema.playlistEpisodes.episodeId, episodeId),
          ))
          .limit(1);
        return rows.length > 0;
      },
      /** 收藏：自动建默认列表后加入（已存在 → added=false 幂等） */
      async addFavorite(userId, episodeId) {
        const { id } = await this.getOrCreateDefault(userId);
        return this.addEpisode(id, episodeId);
      },
      /** 取消收藏（不存在静默） */
      async removeFavorite(userId, episodeId) {
        const { id } = await this.getOrCreateDefault(userId);
        await this.removeEpisode(id, episodeId);
      },
      async update(id, row) {
        await db.update(schema.playlists)
          .set({
            ...(row.title !== undefined ? { title: row.title } : {}),
            ...(row.description !== undefined ? { description: row.description } : {}),
            ...(row.isPublic !== undefined ? { isPublic: row.isPublic } : {}),
            ...(row.isPicked !== undefined ? { isPicked: row.isPicked } : {}),
            ...(row.language !== undefined ? { language: row.language } : {}),
            ...(row.coverUrl !== undefined ? { coverUrl: row.coverUrl } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.playlists.id, id));
      },
      async getPublicCover(playlistId) {
        const rows = await db
          .select({ coverUrl: schema.playlists.coverUrl })
          .from(schema.playlists)
          .where(and(eq(schema.playlists.id, playlistId), eq(schema.playlists.isPublic, true)))
          .limit(1);
        return rows[0]?.coverUrl ?? null;
      },
      /** 用户默认列表（「我的收藏」）：slug = 'favorites-' + userId 确定性；不存在则创建 */
      async getOrCreateDefault(userId) {
        const rows = await db
          .select({ id: schema.playlists.id })
          .from(schema.playlists)
          .where(and(eq(schema.playlists.ownerId, userId), eq(schema.playlists.isDefault, true)))
          .limit(1);
        if (rows[0]) return { id: rows[0].id };
        // 竞态兜底：并发首访时唯一约束 slug 冲突 → 重查
        try {
          const inserted = await db.insert(schema.playlists).values({
            slug: `favorites-${userId}`,
            kind: "user",
            ownerId: userId,
            title: "我的收藏",
            language: "zh",
            isPublic: false, // 默认列表强制私有
            isPicked: false,
            isDefault: true,
          }).returning({ id: schema.playlists.id });
          return { id: inserted[0].id };
        } catch (err) {
          if (isUniqueViolation(err)) {
            const again = await db
              .select({ id: schema.playlists.id })
              .from(schema.playlists)
              .where(and(eq(schema.playlists.ownerId, userId), eq(schema.playlists.isDefault, true)))
              .limit(1);
            if (again[0]) return { id: again[0].id };
          }
          throw err;
        }
      },
      async remove(id) {
        await db.delete(schema.playlists).where(eq(schema.playlists.id, id));
      },
      /** 列表节目（含 position；publicOnly 只留已发布公开节目） */
      async listEpisodes(playlistId, opts = {}) {
        return db.select({
          position: schema.playlistEpisodes.position,
          episodeId: schema.episodes.id,
          slug: schema.episodes.slug,
          title: schema.episodes.title,
          coverUrl: schema.episodes.coverUrl,
          durationSeconds: schema.episodes.durationSeconds,
          publishedAt: schema.episodes.publishedAt,
          language: schema.episodes.language,
          audioUrl: schema.episodes.audioUrl,
          username: schema.authUsers.name,
          displayName: schema.profiles.displayName,
          callName: sql<string>`${schema.submissions.host}->>'callName'`,
        })
          .from(schema.playlistEpisodes)
          .innerJoin(schema.episodes, eq(schema.episodes.id, schema.playlistEpisodes.episodeId))
          .innerJoin(schema.submissions, eq(schema.submissions.id, schema.episodes.submissionId))
          .innerJoin(schema.profiles, eq(schema.profiles.id, schema.episodes.userId))
          .innerJoin(schema.authUsers, eq(schema.authUsers.id, schema.profiles.id))
          .where(and(
            eq(schema.playlistEpisodes.playlistId, playlistId),
            opts.publicOnly
              ? and(eq(schema.episodes.status, "published"), eq(schema.episodes.isPublic, true))
              : undefined,
          ))
          .orderBy(schema.playlistEpisodes.position);
      },
      /** 添加节目（position = max+1 追加末尾；重复收录 → added=false 幂等） */
      async addEpisode(playlistId, episodeId) {
        const [maxRow] = await db
          .select({ max: sql<number>`COALESCE(MAX(${schema.playlistEpisodes.position}), -1)` })
          .from(schema.playlistEpisodes)
          .where(eq(schema.playlistEpisodes.playlistId, playlistId));
        const position = (maxRow?.max ?? -1) + 1;
        try {
          await db.insert(schema.playlistEpisodes).values({ playlistId, episodeId, position });
          return { added: true };
        } catch (err) {
          if (isUniqueViolation(err)) return { added: false }; // 已存在 → 幂等
          throw err;
        }
      },
      async removeEpisode(playlistId, episodeId) {
        await db.delete(schema.playlistEpisodes)
          .where(and(
            eq(schema.playlistEpisodes.playlistId, playlistId),
            eq(schema.playlistEpisodes.episodeId, episodeId),
          ));
      },
      /** 重排（事务：按数组顺序重写 position；未列出的既有条目保留末尾） */
      async reorder(playlistId, orderedEpisodeIds) {
        await db.transaction(async (tx) => {
          const rows = await tx
            .select({ episodeId: schema.playlistEpisodes.episodeId })
            .from(schema.playlistEpisodes)
            .where(eq(schema.playlistEpisodes.playlistId, playlistId));
          const existing = rows.map((r) => r.episodeId);
          const ordered = [...new Set(orderedEpisodeIds.filter((id) => existing.includes(id)))];
          const rest = existing.filter((id) => !ordered.includes(id));
          const final = [...ordered, ...rest];
          // 条目量小（列表 ≤ 数十期），事务内逐条重写 position 可接受
          await Promise.all(final.map((episodeId, i) =>
            tx.update(schema.playlistEpisodes)
              .set({ position: i })
              .where(and(
                eq(schema.playlistEpisodes.playlistId, playlistId),
                eq(schema.playlistEpisodes.episodeId, episodeId),
              )),
          ));
        });
      },
      /** 节目收录于哪些公开列表（节目页「收录于」反查） */
      async listByEpisode(episodeId) {
        return db
          .select({
            id: schema.playlists.id,
            slug: schema.playlists.slug,
            title: schema.playlists.title,
          })
          .from(schema.playlistEpisodes)
          .innerJoin(schema.playlists, eq(schema.playlists.id, schema.playlistEpisodes.playlistId))
          .where(and(
            eq(schema.playlistEpisodes.episodeId, episodeId),
            eq(schema.playlists.isPublic, true),
          ))
          .orderBy(desc(schema.playlists.updatedAt));
      },
    },
  };
}