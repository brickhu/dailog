import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";
import SubmissionSummary from "../components/submission-summary";
import type { AdminSubmissionSummary } from "../lib/types";

// 审核详情（/reviews/:id）：投稿摘要 + 对话原文（折叠）全局展示；状态分支：
//   submitted → [审核][拒审]（前端暂态"审核中…"等待 LLM）
//   rejected  → 拒审原因 + 时间 + 拒审人（LLM/编辑）+ 是否通知投稿人
//   accepted  → 审核通过 + N 篇脚本 + [选择脚本生成节目] → /generate/:id

interface ReviewDetail extends AdminSubmissionSummary {
  createdAt: string;
  dialogue: {
    platform: string | null;
    sourceTitle: string | null;
    messages: { role: string; content: string }[];
  };
  prefixSource: { snapshotId: string; sourceTitle: string | null } | null;
  transcripts: { id: string; title: string | null; topic: string | null; creationNote: string | null; language: string | null; createdAt: string }[];
}

const styles = stylex.create({
  page: { maxWidth: "860px", margin: "0 auto", padding: dimensions.spacing8, display: "flex", flexDirection: "column", gap: dimensions.spacing5 },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, margin: 0 },
  back: { color: colors.neutral, fontSize: dimensions.fontSizeSm, textDecoration: "none" },
  card: {
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
  cardTitle: { fontSize: dimensions.fontSizeLg, fontWeight: dimensions.fontWeightMedium, margin: 0 },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
  msg: { fontSize: dimensions.fontSizeMd, lineHeight: 1.6, margin: 0 },
  msgUser: { color: colors.foreground },
  msgGuest: { color: colors.neutral },
  traceHint: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
    borderLeft: `3px solid ${colors.brand}`,
    paddingLeft: dimensions.spacing3,
  },
  actions: { display: "flex", gap: dimensions.spacing3, alignItems: "center", flexWrap: "wrap" },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
  },
  label: { fontSize: dimensions.fontSizeSm, color: colors.neutral },
  error: { color: colors.danger, fontSize: dimensions.fontSizeSm, margin: 0 },
  ok: { color: colors.brandStrong, fontSize: dimensions.fontSizeMd, margin: 0 },
  infoRow: { display: "flex", flexWrap: "wrap", gap: `${dimensions.spacing2} ${dimensions.spacing5}`, fontSize: dimensions.fontSizeSm, color: colors.neutral },
  infoItem: { display: "flex", gap: dimensions.spacing1 },
  toggle: {
    background: "none",
    border: "none",
    color: colors.brandStrong,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    padding: 0,
    textDecoration: "underline",
  },
});

export default function ReviewPage() {
  const { t } = useI18n();
  const params = useParams();
  const navigate = useNavigate();
  const [detail, detailOps] = createResource<ReviewDetail | null, string>(params.id, async (id) => {
    try {
      return await api.get<ReviewDetail>(`/v1/editor/reviews/${id}`);
    } catch {
      return null;
    }
  });

  // 审核：前端暂态——点击[审核]后页面显示"审核中…"，LLM 返回后刷新状态
  const [reviewing, setReviewing] = createSignal(false);
  const [reviewError, setReviewError] = createSignal<string | null>(null);
  // 拒审：输入理由后确认
  const [showRejectInput, setShowRejectInput] = createSignal(false);
  const [rejectReason, setRejectReason] = createSignal("");
  const [rejecting, setRejecting] = createSignal(false);
  const [rejectError, setRejectError] = createSignal<string | null>(null);
  // 对话原文（默认收起）
  const [dialogueOpen, setDialogueOpen] = createSignal(false);

  const doApprove = async () => {
    setReviewing(true);
    setReviewError(null);
    try {
      // LLM 审核+创作脚本（约 1–2 分钟）——120s 超时
      await api.post(`/v1/editor/reviews/${params.id}/process`, {}, { timeoutMs: 120_000 });
      await detailOps.refetch();
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  };

  const doReject = async () => {
    if (!rejectReason().trim()) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await api.post(`/v1/editor/reviews/${params.id}/reject`, { reason: rejectReason().trim() });
      setShowRejectInput(false);
      setRejectReason("");
      await detailOps.refetch();
    } catch (e) {
      setRejectError(e instanceof Error ? e.message : String(e));
    } finally {
      setRejecting(false);
    }
  };

  const status = () => detail()?.status;
  const fmt = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString("zh-CN") : "";

  return (
    <div {...stylex.props(styles.page)}>
      <a href="/reviews" {...stylex.props(styles.back)}>{t("admin.back")}</a>
      <h1 {...stylex.props(styles.title)}>{detail()?.title ?? t("common.unnamed")}</h1>
      <Show when={detail()}>
        {/* 1.1 投稿摘要（全局展示） */}
        <SubmissionSummary data={detail()!} />

        {/* 内容溯源提示：衍生对话（前缀源自动检测） */}
        <Show when={detail()!.prefixSource}>
          <p {...stylex.props(styles.traceHint)}>
            {t("admin.prefixSource", { title: detail()!.prefixSource!.sourceTitle || t("common.unnamed") })}
          </p>
        </Show>

        {/* 1.3 待审核：审核 / 拒审（仅 submitted 展示） */}
        <Show when={status() === "submitted" && !reviewing()}>
          <div {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={doApprove}>{t("admin.approve")}</Button>
              <Button appear="outline" onClick={() => setShowRejectInput(!showRejectInput())}>
                {t("admin.reject")}
              </Button>
            </div>
            <Show when={showRejectInput()}>
              <label {...stylex.props(styles.label)}>{t("admin.rejectReason")}</label>
              <textarea
                {...stylex.props(styles.input)}
                rows={3}
                placeholder={t("admin.rejectReasonPlaceholder")}
                value={rejectReason()}
                onInput={(e) => setRejectReason(e.currentTarget.value)}
              />
              <div {...stylex.props(styles.actions)}>
                <Button onClick={doReject} disabled={!rejectReason().trim() || rejecting()}>
                  {rejecting() ? t("admin.loading") : t("admin.confirmReject")}
                </Button>
                <Button appear="ghost" onClick={() => setShowRejectInput(false)}>{t("admin.cancel")}</Button>
              </div>
            </Show>
            <Show when={rejectError()}>
              <p {...stylex.props(styles.error)}>{rejectError()}</p>
            </Show>
            <Show when={reviewError()}>
              <p {...stylex.props(styles.error)}>{reviewError()}</p>
            </Show>
          </div>
        </Show>

        {/* 1.3 审核中（仅 submitted 且点击审核后展示；前端暂态） */}
        <Show when={status() === "submitted" && reviewing()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.ok)}>{t("admin.underReview")}</p>
            <p {...stylex.props(styles.meta)}>{t("admin.approveHint")}</p>
            <Show when={reviewError()}>
              <p {...stylex.props(styles.error)}>{reviewError()}</p>
            </Show>
          </div>
        </Show>

        {/* 1.4 审核未通过（仅 rejected 展示） */}
        <Show when={status() === "rejected"}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.reviewFailed")}</p>
            <div {...stylex.props(styles.infoRow)}>
              <span {...stylex.props(styles.infoItem)}>
                <span>{t("admin.rejectReason")}：</span>
                <span style={{ color: colors.foreground }}>{detail()!.rejectedReason ?? "-"}</span>
              </span>
              <span {...stylex.props(styles.infoItem)}>
                <span>{t("admin.reviewedAt")}：</span>
                <span>{fmt(detail()!.reviewedAt)}</span>
              </span>
              <span {...stylex.props(styles.infoItem)}>
                <span>{t("admin.reviewedBy")}：</span>
                <span>
                  {detail()!.reviewedBy === "llm"
                    ? t("admin.reviewedByLlm")
                    : detail()!.reviewedBy === "editor"
                      ? t("admin.reviewedByEditor")
                      : "-"}
                </span>
              </span>
              <span {...stylex.props(styles.infoItem)}>
                <span>{detail()!.notified ? t("admin.notifiedUser") : t("admin.notNotifiedUser")}</span>
              </span>
            </div>
          </div>
        </Show>

        {/* 1.5 审核通过（仅 accepted 展示）：N 篇脚本 + 进入生成 */}
        <Show when={status() === "accepted"}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.ok)}>{t("admin.approved")}</p>
            <p {...stylex.props(styles.meta)}>{t("admin.scriptCount", { n: detail()!.transcripts.length })}</p>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={() => navigate(`/generate/${params.id}`)}>
                {t("admin.chooseScriptToGenerate")}
              </Button>
            </div>
          </div>
        </Show>

        {/* 1.2 对话原文（默认收起，可展开；全局展示） */}
        <div {...stylex.props(styles.card)}>
          <div {...stylex.props(styles.actions)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.dialogue")}</p>
            <button type="button" {...stylex.props(styles.toggle)} onClick={() => setDialogueOpen(!dialogueOpen())}>
              {dialogueOpen() ? t("admin.collapse") : `${t("admin.expand")} (${detail()!.dialogue.messages.length})`}
            </button>
          </div>
          <Show when={dialogueOpen()}>
            <For each={detail()!.dialogue.messages}>
              {(m) => (
                <p {...stylex.props(styles.msg, m.role === "user" ? styles.msgUser : styles.msgGuest)}>
                  <strong>{m.role === "user" ? t("admin.host") : t("admin.guest")}</strong>：{m.content}
                </p>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}
