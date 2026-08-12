import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { api, apiUrl } from "../lib/client";

// 发布页（/publish/:id）：全局 = 标题/封面/摘要（可修改）+ 语音预览 + 投稿摘要 + 脚本摘要 + 主持人/嘉宾信息
// 状态分支：发布中（tips）| 发布失败（[重新发布]）| 发布成功（节目 URL + 是否已通知投稿人）
// 数据源：GET /v1/editor/episodes/:id/publish-detail；发布 = POST /publish；已发布后修改 = PUT /episodes/:id

interface PublishDetail {
  episode: {
    id: string;
    title: string | null;
    description: string | null;
    coverUrl: string | null;
    tags: string[] | null;
    status: string;
    number: number | null;
    publishedAt: string | null;
  };
  audioUrl: string | null;
  polish: { id: string; title: string | null; snapshotUrl: string | null; sourceTitle: string | null; email: string | null } | null;
  transcript: { id: string; title: string | null; topic: string | null; language: string | null; segments: { speaker: "host" | "guest"; text: string }[] } | null;
  host: { id: string | null; name: string | null; callName: string | null; hasSample: boolean } | null;
  guest: { id: string; name: string } | null;
  notified: boolean;
  programUrl: string | null;
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
  cover: { maxWidth: "240px", borderRadius: dimensions.radiusSm, border: `1px solid ${colors.ink}` },
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
  toggle: {
    background: "none",
    border: "none",
    color: colors.brandStrong,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    padding: 0,
    textDecoration: "underline",
  },
  segment: { fontSize: dimensions.fontSizeSm, lineHeight: 1.5, margin: 0, color: colors.neutral },
});

export default function PublishPage() {
  const { t } = useI18n();
  const params = useParams();
  const [detail, detailOps] = createResource<PublishDetail | null, string>(params.id, async (id) => {
    try {
      return await api.get<PublishDetail>(`/v1/editor/episodes/${id}/publish-detail`);
    } catch {
      return null;
    }
  });

  const [title, setTitle] = createSignal("");
  const [cover, setCover] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [tags, setTags] = createSignal("");
  const [segmentsOpen, setSegmentsOpen] = createSignal(false);

  const [publishing, setPublishing] = createSignal(false);
  const [publishFailed, setPublishFailed] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saveMsg, setSaveMsg] = createSignal<string | null>(null);

  // 详情加载后回填表单
  createEffect(() => {
    const d = detail();
    if (d) {
      setTitle(d.episode.title ?? "");
      setCover(d.episode.coverUrl && d.episode.coverUrl.startsWith("http") ? d.episode.coverUrl : "");
      setDescription(d.episode.description ?? "");
      setTags((d.episode.tags ?? []).join(", "));
    }
  });

  const doPublish = async () => {
    if (!title().trim()) return;
    setPublishing(true);
    setPublishFailed(null);
    try {
      await api.post(`/v1/editor/episodes/${params.id}/publish`, {
        title: title().trim(),
        description: description().trim() || null,
        tags: tags().split(",").map((s) => s.trim()).filter(Boolean),
        coverUrl: cover().trim() || null,
      });
      await detailOps.refetch();
    } catch (e) {
      setPublishFailed(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  };

  const doSave = async () => {
    if (!title().trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await api.put(`/v1/editor/episodes/${params.id}`, {
        title: title().trim(),
        description: description().trim() || null,
        coverUrl: cover().trim() || null,
        tags: tags().split(",").map((s) => s.trim()).filter(Boolean),
      });
      setSaveMsg(t("admin.saved"));
      await detailOps.refetch();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const isPublished = () => detail()?.episode.status === "published";

  return (
    <div {...stylex.props(styles.page)}>
      <a href="/episodes" {...stylex.props(styles.back)}>{t("admin.back")}</a>
      <h1 {...stylex.props(styles.title)}>{detail()?.episode.title ?? t("common.unnamed")}</h1>
      <Show when={detail()}>
        {/* 3.1 元数据（可修改，全局展示）：标题 / 封面 / 摘要 / 标签 */}
        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{t("admin.publishTitle")}</p>
          <label {...stylex.props(styles.label)}>{t("admin.epTitle")}</label>
          <input {...stylex.props(styles.input)} value={title()} onInput={(e) => setTitle(e.currentTarget.value)} />
          <label {...stylex.props(styles.label)}>{t("admin.coverUrl")}</label>
          <input {...stylex.props(styles.input)} placeholder="https://…" value={cover()} onInput={(e) => setCover(e.currentTarget.value)} />
          <Show when={cover().startsWith("http")}>
            <img src={cover()} alt={t("admin.coverPreview")} {...stylex.props(styles.cover)} />
          </Show>
          <label {...stylex.props(styles.label)}>{t("admin.epDescription")}</label>
          <textarea {...stylex.props(styles.input)} rows={3} value={description()} onInput={(e) => setDescription(e.currentTarget.value)} />
          <label {...stylex.props(styles.label)}>{t("admin.epTags")}</label>
          <input {...stylex.props(styles.input)} value={tags()} onInput={(e) => setTags(e.currentTarget.value)} />
          <div {...stylex.props(styles.actions)}>
            <Show when={!isPublished()}>
              <Button onClick={doPublish} disabled={!title().trim() || publishing()}>
                {publishing() ? t("admin.loading") : t("admin.publishConfirm")}
              </Button>
            </Show>
            <Show when={isPublished()}>
              <Button onClick={doSave} disabled={!title().trim() || saving()}>
                {saving() ? t("admin.loading") : t("admin.saveChanges")}
              </Button>
            </Show>
          </div>
          <Show when={saveMsg()}>
            <p {...stylex.props(styles.meta)}>{saveMsg()}</p>
          </Show>
        </div>

        {/* 语音预览（全局展示） */}
        <Show when={detail()!.audioUrl}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.episodePreview")}</p>
            <audio controls src={apiUrl(detail()!.audioUrl!)} {...stylex.props(styles.audio)} />
          </div>
        </Show>

        {/* 投稿摘要（id / URL / 邮箱 / 标题，全局展示） */}
        <Show when={detail()!.polish}>
          <div {...stylex.props(styles.card)}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.summary")}</p>
            <div {...stylex.props(styles.actions)}>
              <a href={`/reviews/${detail()!.polish!.id}`} {...stylex.props(styles.link)}>{detail()!.polish!.id}</a>
              <Show when={detail()!.polish!.snapshotUrl}>
                <a href={detail()!.polish!.snapshotUrl!} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
                  {t("admin.shareUrl")}
                </a>
              </Show>
              <span {...stylex.props(styles.meta)}>{detail()!.polish!.email ?? "-"}</span>
            </div>
            <p {...stylex.props(styles.meta)}>{detail()!.polish!.title ?? detail()!.polish!.sourceTitle ?? t("common.unnamed")}</p>
          </div>
        </Show>

        {/* 脚本摘要（全局展示）：标题/主题/语言 + 段落（默认收起） */}
        <Show when={detail()!.transcript}>
          <div {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.actions)}>
              <p {...stylex.props(styles.cardTitle)}>{t("admin.scriptSummary")}</p>
              <button type="button" {...stylex.props(styles.toggle)} onClick={() => setSegmentsOpen(!segmentsOpen())}>
                {segmentsOpen() ? t("admin.collapse") : t("admin.expand")}
              </button>
            </div>
            <p {...stylex.props(styles.meta)}>
              {detail()!.transcript!.title ?? detail()!.transcript!.topic ?? t("common.unnamed")}
              {detail()!.transcript!.language ? ` · ${detail()!.transcript!.language}` : ""}
            </p>
            <Show when={segmentsOpen()}>
              <For each={detail()!.transcript!.segments}>
                {(seg) => (
                  <p {...stylex.props(styles.segment)}>
                    <strong>{seg.speaker === "host" ? t("admin.host") : t("admin.guest")}</strong>：{seg.text}
                  </p>
                )}
              </For>
            </Show>
          </div>
        </Show>

        {/* 主持人 / 嘉宾信息（全局展示） */}
        <div {...stylex.props(styles.card)}>
          <p {...stylex.props(styles.cardTitle)}>{t("admin.hostPersona")}</p>
          <div {...stylex.props(styles.actions)}>
            <span {...stylex.props(styles.meta)}>
              {detail()!.host?.name ?? detail()!.host?.callName ?? t("common.unnamed")}
            </span>
            <Show when={detail()!.host?.hasSample && detail()!.host?.id}>
              <audio controls src={apiUrl(`/v1/editor/samples/host/${detail()!.host!.id}/audio`)} {...stylex.props(styles.audio)} />
            </Show>
          </div>
          <Show when={detail()!.guest}>
            <p {...stylex.props(styles.cardTitle)}>{t("admin.aiPersona")}</p>
            <span {...stylex.props(styles.meta)}>{detail()!.guest!.name}</span>
          </Show>
        </div>

        {/* 3.3 发布中 tips（点击发布后展示） */}
        <Show when={publishing()}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.publishingTips")}</p>
          </div>
        </Show>

        {/* 3.4 发布失败：[重新发布]（仅失败状态） */}
        <Show when={publishFailed()}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.publishFailed")}</p>
            <p {...stylex.props(styles.error)}>{publishFailed()}</p>
            <div {...stylex.props(styles.actions)}>
              <Button onClick={doPublish} disabled={!title().trim() || publishing()}>{t("admin.republish")}</Button>
            </div>
          </div>
        </Show>

        {/* 3.2/3.5/3.6 发布成功：节目 URL + 是否已通知投稿人（仅已发布） */}
        <Show when={isPublished()}>
          <div {...stylex.props(styles.stateBanner)}>
            <p {...stylex.props(styles.stateTitle)}>{t("admin.published")}</p>
            <Show when={detail()!.programUrl}>
              <a href={detail()!.programUrl!} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
                {detail()!.programUrl}
              </a>
            </Show>
            <Show when={detail()!.notified} fallback={
              <p {...stylex.props(styles.meta)}>{t("admin.notifyPending", { email: detail()!.polish?.email ?? "-" })}</p>
            }>
              <p {...stylex.props(styles.ok)}>{t("admin.notifySent", { email: detail()!.polish?.email ?? "-" })}</p>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
