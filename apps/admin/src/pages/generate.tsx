import { createEffect, createResource, createSignal, For, Show, onCleanup } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { api, apiUrl } from "../lib/client";
import SubmissionSummary from "../components/submission-summary";
import type { AdminGenerateDetail, AdminScript } from "../lib/types";

// 生成任务详情（/generate/:id）：
//   全局：投稿摘要 + 审核结果（id 链接 /reviews/:id + 审核通过时间）
//   语音状态推导（生成中 > 失败 > 已生成 > 已发布 > 未生成）：
//     voicePending   脚本列表（首个默认展开）+ 选择生成 + 追加脚本
//     voiceGenerating 正在基于该脚本生成语音（5s 轮询刷新）
//     voiceFailed     语音生成失败 + [重新生成]
//     voiceReady      试听 + [发布]（弹框：标题/封面/摘要 LLM 预填可改）
//     published       已发布（链接 /publish/:id）
//   追加脚本期间（前端暂态）展示"脚本创作中"，禁止选择其他脚本

const RUNNING_JOBS = ["queued", "tts", "merge", "upload"];

interface PublishForm {
  title: string | null;
  description: string | null;
  tags: string[] | null;
  topic: string | null;
  coverKeywords: string[] | null;
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
  link: { color: colors.brandStrong, textDecoration: "underline" },
  actions: { display: "flex", gap: dimensions.spacing3, alignItems: "center", flexWrap: "wrap" },
  error: { color: colors.danger, fontSize: dimensions.fontSizeSm, margin: 0 },
  ok: { color: colors.brandStrong, fontSize: dimensions.fontSizeMd, margin: 0 },
  stateBanner: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.surface,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  stateTitle: { fontSize: dimensions.fontSizeMd, fontWeight: dimensions.fontWeightMedium, margin: 0 },
  scriptRow: {
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
  },
  scriptHeader: { display: "flex", alignItems: "center", gap: dimensions.spacing3, flexWrap: "wrap" },
  scriptTitle: { fontWeight: dimensions.fontWeightMedium, fontSize: dimensions.fontSizeMd, margin: 0 },
  scriptNote: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: 0 },
  segment: { fontSize: dimensions.fontSizeSm, lineHeight: 1.5, margin: 0, color: colors.neutral },
  toggle: {
    background: "none",
    border: "none",
    color: colors.brandStrong,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    padding: 0,
    textDecoration: "underline",
  },
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
  audio: { width: "100%", maxWidth: "420px" },
  badge: {
    display: "inline-block",
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    fontSize: dimensions.fontSizeSm,
  },
  // 发布弹框
  overlay: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    padding: dimensions.spacing4,
  },
  modal: {
    width: "100%",
    maxWidth: "520px",
    maxHeight: "80vh",
    overflowY: "auto",
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
  },
});

function SegmentList(props: { segments: AdminScript["segments"] }) {
  const { t } = useI18n();
  return (
    <For each={props.segments}>
      {(seg) => (
        <p {...stylex.props(styles.segment)}>
          <strong>{seg.speaker === "host" ? t("admin.host") : t("admin.guest")}</strong>：{seg.text}
        </p>
      )}
    </For>
  );
}

export default function GeneratePage() {
  const { t } = useI18n();
  const params = useParams();
  const navigate = useNavigate();
  const [detail, detailOps] = createResource<AdminGenerateDetail | null, string>(params.id, async (id) => {
    try {
      return await api.get<AdminGenerateDetail>(`/v1/editor/generates/${id}`);
    } catch {
      return null;
    }
  });

  // 脚本展开（首个默认展开）
  const [expanded, setExpanded] = createSignal<string | null>(null);
  createEffect(() => {
    const s = detail()?.scripts;
    if (s && s.length > 0 && !expanded()) setExpanded(s[0].id);
  });

  // 追加脚本（暂态：创作中禁止选择其他脚本）
  const [appending, setAppending] = createSignal(false);
  const [appendPrompt, setAppendPrompt] = createSignal("");
  const [appendError, setAppendError] = createSignal<string | null>(null);
  // 选择脚本生成（暂态）
  const [selecting, setSelecting] = createSignal<string | null>(null);
  const [genError, setGenError] = createSignal<string | null>(null);
  // 发布弹框
  const [publishEp, setPublishEp] = createSignal<{ id: string; transcriptId: string } | null>(null);
  const [publishFormLoading, setPublishFormLoading] = createSignal(false);
  const [pubTitle, setPubTitle] = createSignal("");
  const [pubCover, setPubCover] = createSignal("");
  const [pubDesc, setPubDesc] = createSignal("");
  const [pubTags, setPubTags] = createSignal("");
  const [publishing, setPublishing] = createSignal(false);
  const [publishError, setPublishError] = createSignal<string | null>(null);

  const scripts = () => detail()?.scripts ?? [];
  const runningScript = () => scripts().find((s) => s.episode && (s.episode.status === "generating" || RUNNING_JOBS.includes(s.episode.jobStatus ?? "")));
  const failedScript = () => scripts().find((s) => s.episode?.status === "failed");
  const readyScript = () => scripts().find((s) => s.episode?.status === "ready");
  const publishedScript = () => scripts().find((s) => s.episode?.status === "published");
  // 页面语音状态：脚本创作失败（投稿被拒）> 追加中 > 生成中 > 失败 > 已生成 > 已发布 > 未生成
  const voiceState = () =>
    detail()?.status === "rejected" ? "scriptFailed"
      : appending() ? "scriptCreating"
        : runningScript() ? "voiceGenerating"
          : failedScript() ? "voiceFailed"
            : readyScript() ? "voiceReady"
              : publishedScript() ? "published"
                : "voicePending";

  // 语音生成中：5s 轮询刷新
  createEffect(() => {
    if (voiceState() === "voiceGenerating") {
      const timer = setInterval(() => detailOps.refetch(), 5000);
      onCleanup(() => clearInterval(timer));
    }
  });

  const doGenerate = async (scriptId: string) => {
    setSelecting(scriptId);
    setGenError(null);
    try {
      await api.post("/v1/editor/episodes/new", { transcriptId: scriptId });
      await detailOps.refetch();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  };

  const doRetry = async (episodeId: string) => {
    setSelecting(episodeId);
    setGenError(null);
    try {
      await api.post(`/v1/editor/episodes/${episodeId}/retry`);
      await detailOps.refetch();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setSelecting(null);
    }
  };

  const doAppend = async () => {
    if (!appendPrompt().trim()) return;
    setAppending(true);
    setAppendError(null);
    try {
      await api.post(`/v1/editor/reviews/${params.id}/scripts`, { prompt: appendPrompt().trim() });
      setAppendPrompt("");
      await detailOps.refetch();
    } catch (e) {
      setAppendError(e instanceof Error ? e.message : String(e));
    } finally {
      setAppending(false);
    }
  };

  const openPublish = async (ep: { id: string; transcriptId: string }) => {
    setPublishEp(ep);
    setPublishError(null);
    setPublishFormLoading(true);
    try {
      const form = await api.get<PublishForm>(`/v1/editor/episodes/${ep.id}/publish-form`, { timeoutMs: 120_000 });
      setPubTitle(form.title ?? "");
      setPubCover("");
      setPubDesc(form.description ?? "");
      setPubTags((form.tags ?? []).join(", "));
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishFormLoading(false);
    }
  };

  const doPublish = async () => {
    const ep = publishEp();
    if (!ep || !pubTitle().trim()) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await api.post(`/v1/editor/episodes/${ep.id}/publish`, {
        title: pubTitle().trim(),
        description: pubDesc().trim() || null,
        tags: pubTags().split(",").map((s) => s.trim()).filter(Boolean),
        coverUrl: pubCover().trim() || null,
      });
      navigate(`/publish/${ep.id}`);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
      setPublishing(false);
    }
  };

  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("zh-CN") : "");

  return (
    <div {...stylex.props(styles.page)}>
      <a href="/generates" {...stylex.props(styles.back)}>{t("admin.back")}</a>
      <h1 {...stylex.props(styles.title)}>{detail()?.title ?? t("common.unnamed")}</h1>
      <Show when={detail()}>
        {/* 2.1 投稿摘要（全局展示） */}
        <SubmissionSummary data={detail()!} />

        {/* 2.2 审核结果：id 链接 + 审核通过时间（全局展示） */}
        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{t("admin.reviewResult")}</p>
          <div {...stylex.props(styles.actions)}>
            <a href={`/reviews/${params.id}`} {...stylex.props(styles.link)}>{params.id}</a>
            <span {...stylex.props(styles.meta)}>{t("admin.reviewPassedAt")}：{fmt(detail()!.reviewedAt)}</span>
          </div>
        </div>

        {/* 2.4/2.7 脚本创作中 / 脚本创作失败（仅这些状态下展示） */}
        <Show when={voiceState() === "scriptCreating"}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.scriptCreating")}</p>
            <p {...stylex.props(styles.meta)}>{t("admin.appendBlockedHint")}</p>
          </div>
        </Show>
        <Show when={voiceState() === "scriptFailed"}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.scriptFailed")}</p>
            <Show when={detail()!.rejectedReason}>
              <p {...stylex.props(styles.meta)}>{t("admin.rejectReason")}：{detail()!.rejectedReason}</p>
            </Show>
          </div>
        </Show>

        {/* 2.5 语音生成中（仅该状态） */}
        <Show when={voiceState() === "voiceGenerating" && runningScript()}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.voiceGenerating")}</p>
            <div {...stylex.props(styles.scriptRow)}>
              <div {...stylex.props(styles.scriptHeader)}>
                <span {...stylex.props(styles.scriptTitle)}>{t("admin.scriptIndex", { n: scripts().indexOf(runningScript()!) + 1 })}</span>
                <span {...stylex.props(styles.scriptTitle)}>{runningScript()!.title ?? runningScript()!.topic ?? t("common.unnamed")}</span>
              </div>
              <Show when={runningScript()!.segments.length > 0}>
                <button type="button" {...stylex.props(styles.toggle)} onClick={() => setExpanded(expanded() === runningScript()!.id ? null : runningScript()!.id)}>
                  {expanded() === runningScript()!.id ? t("admin.collapse") : t("admin.expand")}
                </button>
                <Show when={expanded() === runningScript()!.id}>
                  <SegmentList segments={runningScript()!.segments} />
                </Show>
              </Show>
              <p {...stylex.props(styles.meta)}>{t("admin.generatingVoice")}</p>
            </div>
          </div>
        </Show>

        {/* 2.7 语音生成失败（仅该状态）：重新生成 */}
        <Show when={voiceState() === "voiceFailed" && failedScript()}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.voiceFailedText")}</p>
            <div {...stylex.props(styles.scriptRow)}>
              <div {...stylex.props(styles.scriptHeader)}>
                <span {...stylex.props(styles.scriptTitle)}>{t("admin.scriptIndex", { n: scripts().indexOf(failedScript()!) + 1 })}</span>
                <span {...stylex.props(styles.scriptTitle)}>{failedScript()!.title ?? failedScript()!.topic ?? t("common.unnamed")}</span>
              </div>
              <button type="button" {...stylex.props(styles.toggle)} onClick={() => setExpanded(expanded() === failedScript()!.id ? null : failedScript()!.id)}>
                {expanded() === failedScript()!.id ? t("admin.collapse") : t("admin.expand")}
              </button>
              <Show when={expanded() === failedScript()!.id}>
                <SegmentList segments={failedScript()!.segments} />
              </Show>
              <Show when={failedScript()!.episode?.jobError}>
                <p {...stylex.props(styles.error)}>{t("admin.jobError", { error: failedScript()!.episode!.jobError! })}</p>
              </Show>
            </div>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={() => doRetry(failedScript()!.episode!.id)} disabled={selecting() !== null}>
                {t("admin.regenerate")}
              </Button>
              <Show when={genError()}>
                <p {...stylex.props(styles.error)}>{genError()}</p>
              </Show>
            </div>
          </div>
        </Show>

        {/* 2.6 语音已生成 / 已发布（仅这两状态）：试听 + 发布 / 已发布链接 */}
        <Show when={(voiceState() === "voiceReady" && readyScript()) || (voiceState() === "published" && publishedScript())}>
          {(() => {
            const s = voiceState() === "voiceReady" ? readyScript()! : publishedScript()!;
            return (
              <div {...stylex.props(styles.stateBanner)}>
                <p {...stylex.props(styles.stateTitle)}>
                  {s.episode!.status === "published" ? t("admin.published") : t("admin.voiceReady")}
                </p>
                <div {...stylex.props(styles.scriptRow)}>
                  <div {...stylex.props(styles.scriptHeader)}>
                    <span {...stylex.props(styles.scriptTitle)}>{t("admin.scriptIndex", { n: scripts().indexOf(s) + 1 })}</span>
                    <span {...stylex.props(styles.scriptTitle)}>{s.title ?? s.topic ?? t("common.unnamed")}</span>
                  </div>
                  <button type="button" {...stylex.props(styles.toggle)} onClick={() => setExpanded(expanded() === s.id ? null : s.id)}>
                    {expanded() === s.id ? t("admin.collapse") : t("admin.expand")}
                  </button>
                  <Show when={expanded() === s.id}>
                    <SegmentList segments={s.segments} />
                  </Show>
                  <audio controls src={apiUrl(`/v1/editor/episodes/${s.episode!.id}/audio`)} {...stylex.props(styles.audio)} />
                </div>
                <div {...stylex.props(styles.actions)}>
                  <Show when={s.episode!.status === "ready"}>
                    <Button onClick={() => openPublish({ id: s.episode!.id, transcriptId: s.id })}>
                      {t("admin.publishButton")}
                    </Button>
                  </Show>
                  <Show when={s.episode!.status === "published"}>
                    <a href={`/publish/${s.episode!.id}`} {...stylex.props(styles.link)}>{t("admin.publishedLink")}</a>
                  </Show>
                  <Show when={genError()}>
                    <p {...stylex.props(styles.error)}>{genError()}</p>
                  </Show>
                </div>
              </div>
            );
          })()}
        </Show>

        {/* 2.3 未生成语音：脚本列表（首个默认展开）+ 选择生成 + 2.4 追加脚本 */}
        <Show when={voiceState() === "voicePending"}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.scriptList")}</p>
            <For each={scripts()}>
              {(s, i) => (
                <div {...stylex.props(styles.scriptRow)}>
                  <div {...stylex.props(styles.scriptHeader)}>
                    <span {...stylex.props(styles.scriptTitle)}>{t("admin.scriptIndex", { n: i() + 1 })}</span>
                    <span {...stylex.props(styles.scriptTitle)}>{s.title ?? s.topic ?? t("common.unnamed")}</span>
                    <Show when={s.status === "used"}>
                      <span {...stylex.props(styles.badge)}>{t("admin.scriptUsed")}</span>
                    </Show>
                  </div>
                  <Show when={s.creationNote}>
                    <p {...stylex.props(styles.scriptNote)}>{t("admin.creationNote")}：{s.creationNote}</p>
                  </Show>
                  <button type="button" {...stylex.props(styles.toggle)} onClick={() => setExpanded(expanded() === s.id ? null : s.id)}>
                    {expanded() === s.id ? t("admin.collapse") : t("admin.expand")}
                  </button>
                  <Show when={expanded() === s.id}>
                    <SegmentList segments={s.segments} />
                  </Show>
                  <div {...stylex.props(styles.actions)}>
                    <Button onClick={() => doGenerate(s.id)} disabled={selecting() !== null || s.status === "used"}>
                      {selecting() === s.id ? t("admin.loading") : t("admin.selectThisScript")}
                    </Button>
                  </div>
                </div>
              )}
            </For>
            <Show when={genError()}>
              <p {...stylex.props(styles.error)}>{genError()}</p>
            </Show>

            {/* 2.4 追加脚本（仅未生成语音状态） */}
            <div {...stylex.props(styles.scriptRow)}>
              <label {...stylex.props(styles.label)}>{t("admin.appendScript")}</label>
              <input
                {...stylex.props(styles.input)}
                placeholder={t("admin.appendPromptPlaceholder")}
                value={appendPrompt()}
                onInput={(e) => setAppendPrompt(e.currentTarget.value)}
                disabled={appending()}
              />
              <div {...stylex.props(styles.actions)}>
                <Button onClick={doAppend} disabled={!appendPrompt().trim() || appending()}>
                  {appending() ? t("admin.appending") : t("admin.appendScript")}
                </Button>
              </div>
              <Show when={appendError()}>
                <p {...stylex.props(styles.error)}>{appendError()}</p>
              </Show>
            </div>
          </div>
        </Show>
      </Show>

      {/* 发布弹框（2.6）：标题/封面/摘要，LLM 预填可改 */}
      <Show when={publishEp()}>
        <div {...stylex.props(styles.overlay)} onClick={() => !publishing() && setPublishEp(null)}>
          <div {...stylex.props(styles.modal)} onClick={(e) => e.stopPropagation()}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.publishTitle")}</p>
            <Show when={publishFormLoading()}>
              <p {...stylex.props(styles.meta)}>{t("admin.loading")}</p>
            </Show>
            <Show when={!publishFormLoading()}>
              <label {...stylex.props(styles.label)}>{t("admin.epTitle")}</label>
              <input {...stylex.props(styles.input)} value={pubTitle()} onInput={(e) => setPubTitle(e.currentTarget.value)} />
              <label {...stylex.props(styles.label)}>{t("admin.coverUrl")}</label>
              <input {...stylex.props(styles.input)} placeholder="https://…" value={pubCover()} onInput={(e) => setPubCover(e.currentTarget.value)} />
              <label {...stylex.props(styles.label)}>{t("admin.epDescription")}</label>
              <textarea {...stylex.props(styles.input)} rows={3} value={pubDesc()} onInput={(e) => setPubDesc(e.currentTarget.value)} />
              <label {...stylex.props(styles.label)}>{t("admin.epTags")}</label>
              <input {...stylex.props(styles.input)} value={pubTags()} onInput={(e) => setPubTags(e.currentTarget.value)} />
              <div {...stylex.props(styles.actions)}>
                <Button onClick={doPublish} disabled={!pubTitle().trim() || publishing()}>
                  {publishing() ? t("admin.loading") : t("admin.publishConfirm")}
                </Button>
                <Button appear="ghost" onClick={() => setPublishEp(null)} disabled={publishing()}>{t("admin.cancel")}</Button>
              </div>
              <Show when={publishError()}>
                <p {...stylex.props(styles.error)}>{publishError()}</p>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
