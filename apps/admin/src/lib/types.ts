/** 编辑端共享类型：审核详情 / 生成任务详情 / 发布详情 的投稿摘要（后端 reviewSummary 聚合） */

export interface AdminPersona {
  callName?: string | null;
  gender?: string | null;
  profession?: string | null;
  age?: string | null;
  traits?: string | null;
}

export interface AdminSubmissionSummary {
  id: string;
  title: string | null;
  /** 摘要（分享页标题） */
  sourceTitle: string | null;
  /** 对话分享页 url */
  snapshotUrl: string | null;
  /** 消息量 */
  msgCount: number;
  /** 总字数 */
  wordCount: number;
  /** 投稿人邮箱 */
  email: string | null;
  platform: string | null;
  language: string | null;
  status: string;
  rejectedReason: string | null;
  /** 拒审来源：llm（自动）/ editor（人工） */
  reviewedBy: "llm" | "editor" | null;
  reviewedAt: string | null;
  /** 是否已通知投稿人 */
  notified: boolean;
  /** 主持人（投稿人）：userId（采样播放用）+ 展示名 + 人设 + 有无采样 */
  host: { id: string; name: string | null; persona: AdminPersona | null; hasSample: boolean } | null;
  /** AI 嘉宾（按平台） */
  guest: { id: string; name: string; intro: string | null; hasSample: boolean } | null;
}

export interface AdminScript {
  id: string;
  title: string | null;
  topic: string | null;
  creationNote: string | null;
  language: string | null;
  segments: { speaker: "host" | "guest"; text: string }[];
  /** unused / used */
  status: string;
  /** 该脚本生成的节目（未生成 = null） */
  episode: {
    id: string;
    status: string;
    jobStatus: string | null;
    jobError: string | null;
    publishedAt: string | null;
  } | null;
}

/** 生成任务详情（GET /v1/editor/generates/:id） */
export interface AdminGenerateDetail extends AdminSubmissionSummary {
  scripts: AdminScript[];
}
