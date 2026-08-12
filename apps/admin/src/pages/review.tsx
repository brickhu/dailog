import { createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";
import ScriptEditor from "../components/script-editor";

// 审核详情（/reviews/:id）：对话预览 → 审核+润色（process）→ 脚本候选 → 生成 → 发布确认
// P3 基础版：脚本编辑（script-editor 迁移）与封面选择（cover-search）在下一轮接入

interface ReviewDetail {
  id: string;
  title: string | null;
  status: string;
  rejectedReason: string | null;
  createdAt: string;
  dialogue: { platform: string | null; sourceTitle: string | null; messages: { role: string; content: string }[] };
  /** 内容溯源：衍生自库内某快照（自动前缀检测） */
  prefixSource: { snapshotId: string; sourceTitle: string | null } | null;
  transcripts: { id: string; segments: { speaker: string; text: string }[]; topic: string | null; title: string | null; creationNote: string | null; language: string | null; createdAt: string }[];
  episodes: { id: string; title: string | null; status: string; number: number | null; isPicked: boolean; createdAt: string }[];
}

interface ScriptCandidate { id: string; title: string | null; topic: string | null; creationNote: string | null; }
interface PublishForm { title: string | null; description: string | null; tags: string[] | null; topic: string | null; coverKeywords: string[] | null; }

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
  traceHint: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    margin: 0,
    borderLeft: `3px solid ${colors.brand}`,
    paddingLeft: dimensions.spacing3,
  },
  msg: { fontSize: dimensions.fontSizeMd, lineHeight: 1.6, margin: 0 },
  msgUser: { color: colors.foreground },
  msgGuest: { color: colors.neutral },
  badge: {
    display: "inline-block",
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    fontSize: dimensions.fontSizeSm,
  },
  scriptRow: {
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusSm,
    border: `1px solid ${colors.ink}`,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
  },
  scriptTitle: { fontWeight: dimensions.fontWeightMedium, fontSize: dimensions.fontSizeMd, margin: 0 },
  scriptNote: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: 0 },
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
});

export default function ReviewPage() {
  const { t } = useI18n();
  const params = useParams();
  const [processing, setProcessing] = createSignal(false);
  const [processResult, setProcessResult] = createSignal<{ rejected: boolean; reason?: string; transcripts?: ScriptCandidate[] } | null>(null);
  const [processError, setProcessError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<string | null>(null);
  const [generating, setGenerating] = createSignal(false);
  const [generated, setGenerated] = createSignal<{ episodeId: string } | null>(null);
  const [genError, setGenError] = createSignal<string | null>(null);
  const [publishTarget, setPublishTarget] = createSignal<string | null>(null);
  const [retrying, setRetrying] = createSignal(false);
  const [publishForm, setPublishForm] = createSignal<PublishForm | null>(null);
  const [publishLoading, setPublishLoading] = createSignal(false);
  const [published, setPublished] = createSignal<{ number: number } | null>(null);
  const [publishError, setPublishError] = createSignal<string | null>(null);
  const [title, setTitle] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [tags, setTags] = createSignal("");

  const [detail, detailOps] = createResource<ReviewDetail | null, string>(params.id, async (id) => {
    try {
      return await api.get<ReviewDetail>(`/v1/editor/reviews/${id}`);
    } catch {
      return null;
    }
  });

  const doProcess = async () => {
    setProcessing(true);
    setProcessError(null);
    setProcessResult(null);
    try {
      // LLM 审核+润色（1–N 版脚本）耗时较长——120s 超时
      const res = await api.post<{ rejected: boolean; reason?: string; transcripts?: ScriptCandidate[] }>(
        `/v1/editor/reviews/${params.id}/process`,
        {},
        { timeoutMs: 120_000 },
      );
      setProcessResult(res);
    } catch (e) {
      setProcessError(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  };

  const doGenerate = async () => {
    const tid = selected();
    if (!tid) return;
    setGenerating(true);
    setGenError(null);
    setGenerated(null);
    try {
      const res = await api.post<{ episodeId: string }>("/v1/editor/episodes/new", { transcriptId: tid });
      setGenerated(res);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const doRetry = async (episodeId: string) => {
    setRetrying(true);
    setGenError(null);
    try {
      await api.post(`/v1/editor/episodes/${episodeId}/retry`);
      setGenError(t("admin.retrySubmitted"));
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

  const loadPublishForm = async () => {
    const epId = publishTarget() ?? generated()?.episodeId;
    if (!epId) return;
    setPublishLoading(true);
    setPublishError(null);
    try {
      const form = await api.get<PublishForm>(`/v1/editor/episodes/${epId}/publish-form`, { timeoutMs: 60_000 });
      setPublishForm(form);
      setTitle(form.title ?? "");
      setDescription(form.description ?? "");
      setTags((form.tags ?? []).join(", "));
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishLoading(false);
    }
  };

  const doPublish = async () => {
    const epId = publishTarget() ?? generated()?.episodeId;
    if (!epId || !title().trim()) return;
    setPublishError(null);
    try {
      const res = await api.post<{ number: number }>(`/v1/editor/episodes/${epId}/publish`, {
        title: title().trim(),
        description: description().trim() || null,
        tags: tags().split(",").map((s) => s.trim()).filter(Boolean),
      });
      setPublished(res);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
    }
  };

  // 脚本候选：process 结果优先，否则详情里的 transcripts
  const scripts = () => processResult()?.transcripts ?? detail()?.transcripts.map((tr) => ({
    id: tr.id,
    title: null,
    topic: null,
    creationNote: null,
  })) ?? [];
  // 脚本编辑：仅 detail.transcripts（含 segments）可编辑；processResult 候选无 segments
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const editableScript = (id: string) => detail()?.transcripts.find((tr) => tr.id === id) ?? null;

  return (
    <div {...stylex.props(styles.page)}>
      <a href="/" {...stylex.props(styles.back)}>← {t("admin.backToQueue")}</a>
      <h1 {...stylex.props(styles.title)}>{detail()?.title ?? t("common.unnamed")}</h1>
      <Show when={detail()}>
        <div {...stylex.props(styles.meta)}>
          {t(`status.${detail()!.status}` as never)}
          {detail()!.rejectedReason ? ` · ${detail()!.rejectedReason}` : ""}
          {detail()!.dialogue.platform ? ` · ${detail()!.dialogue.platform}` : ""}
        </div>

        {/* 内容溯源提示：衍生对话（前缀源自动检测） */}
        <Show when={detail()!.prefixSource}>
          <p {...stylex.props(styles.traceHint)}>
            {t("admin.prefixSource", { title: detail()!.prefixSource!.sourceTitle || t("common.unnamed") })}
          </p>
        </Show>

        {/* 审核 + 润色 */}
        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{t("admin.reviewAction")}</p>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={doProcess} disabled={processing() || detail()!.status === "rejected"}>
              {processing() ? t("admin.processing") : t("admin.process")}
            </Button>
            {processing() ? <span {...stylex.props(styles.meta)}>{t("admin.processHint")}</span> : null}
          </div>
          <Show when={processResult()?.rejected}>
            <p {...stylex.props(styles.error)}>{t("admin.rejected")}：{processResult()!.reason}</p>
          </Show>
          <Show when={processError()}>
            <p {...stylex.props(styles.error)}>{processError()}</p>
          </Show>
        </div>

        {/* 脚本候选 */}
        <Show when={scripts().length > 0}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.scripts")}</p>
            <For each={scripts()}>
              {(s) => (
                <div {...stylex.props(styles.scriptRow)}>
                  <p {...stylex.props(styles.scriptTitle)}>{s.title || s.topic || t("admin.scriptUntitled")}</p>
                  <Show when={s.creationNote}>
                    <p {...stylex.props(styles.scriptNote)}>{s.creationNote}</p>
                  </Show>
                  <div {...stylex.props(styles.actions)}>
                    <Show when={editableScript(s.id)}>
                      <Button appear={editingId() === s.id ? "outline" : "ghost"} onClick={() => setEditingId(editingId() === s.id ? null : s.id)}>
                        {t("admin.editScript")}
                      </Button>
                    </Show>
                    <Button appear={selected() === s.id ? "outline" : "ghost"} onClick={() => setSelected(s.id)}>
                      {t("admin.selectScript")}
                    </Button>
                  </div>
                  {/* 脚本编辑器（编辑保存写 updated_segments 草稿） */}
                  <Show when={editingId() === s.id}>
                    <ScriptEditor
                      transcriptId={s.id}
                      title={editableScript(s.id)?.title ?? null}
                      topic={editableScript(s.id)?.topic ?? null}
                      creationNote={editableScript(s.id)?.creationNote ?? null}
                      initialSegments={editableScript(s.id)?.segments ?? []}
                      onSaved={() => detailOps.refetch()}
                    />
                  </Show>
                </div>
              )}
            </For>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={doGenerate} disabled={!selected() || generating()}>
                {generating() ? t("admin.generating") : t("admin.generate")}
              </Button>
            </div>
            <Show when={genError()}>
              <p {...stylex.props(styles.error)}>{genError()}</p>
            </Show>
            <Show when={generated()}>
              <p {...stylex.props(styles.ok)}>{t("admin.generated")}：{generated()!.episodeId}</p>
            </Show>
          </div>
        </Show>

        {/* 已生成节目列表（含失败重试/待发布入口） */}
        <Show when={detail()!.episodes.length > 0}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.episodes")}</p>
            <For each={detail()!.episodes}>
              {(ep) => (
                <div {...stylex.props(styles.scriptRow)}>
                  <p {...stylex.props(styles.scriptTitle)}>
                    {ep.number ? `${t("admin.episodeNumber", { number: ep.number })} · ` : ""}{ep.title || t("common.unnamed")}
                    <span {...stylex.props(styles.badge)}>{t(`status.${ep.status}` as never)}</span>
                  </p>
                  <div {...stylex.props(styles.meta)}>
                    {ep.id} · {t(`status.${ep.status}` as never)}
                  </div>
                  <div {...stylex.props(styles.actions)}>
                    <Show when={ep.status === "failed"}>
                      <Button appear="outline" onClick={() => doRetry(ep.id)} disabled={retrying()}>
                        {t("admin.retry")}
                      </Button>
                    </Show>
                    <Show when={ep.status === "ready" && !published()}>
                      <Button onClick={() => setPublishTarget(ep.id)}>{t("admin.goPublish")}</Button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
            <Show when={genError()}>
              <p {...stylex.props(styles.error)}>{genError()}</p>
            </Show>
          </div>
        </Show>

        {/* 发布确认 */}
        <Show when={(generated() || publishTarget()) && !published()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.publish")}</p>
            <Show when={!publishForm()}>
              <div {...stylex.props(styles.actions)}>
                <Button onClick={loadPublishForm} disabled={publishLoading()}>
                  {publishLoading() ? t("admin.loading") : t("admin.loadPublishForm")}
                </Button>
              </div>
            </Show>
            <Show when={publishForm()}>
              <label {...stylex.props(styles.label)}>{t("admin.epTitle")}</label>
              <input {...stylex.props(styles.input)} value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
              <label {...stylex.props(styles.label)}>{t("admin.epDescription")}</label>
              <textarea {...stylex.props(styles.input)} rows={3} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
              <label {...stylex.props(styles.label)}>{t("admin.epTags")}</label>
              <input {...stylex.props(styles.input)} value={tags()} onInput={(e) => setTags(e.currentTarget.value)} />
              <div {...stylex.props(styles.actions)}>
                <Button onClick={doPublish} disabled={!title().trim()}>{t("admin.publishConfirm")}</Button>
              </div>
            </Show>
            <Show when={publishError()}>
              <p {...stylex.props(styles.error)}>{publishError()}</p>
            </Show>
          </div>
        </Show>

        {/* 已发布 */}
        <Show when={published()}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.ok)}>{t("admin.published")}：{t("admin.episodeNumber", { number: published()!.number })}</p>
          </div>
        </Show>

        {/* 对话预览 */}
        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{t("admin.dialogue")}</p>
          <For each={detail()!.dialogue.messages}>
            {(m) => (
              <p {...stylex.props(styles.msg, m.role === "user" ? styles.msgUser : styles.msgGuest)}>
                <strong>{m.role === "user" ? t("admin.host") : t("admin.guest")}</strong>：{m.content}
              </p>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
