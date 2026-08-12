import { createAsync } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { api } from "../lib/client";

// 已发布节目清单：tags / 精选标记 管理（编辑端）
interface PublishedEpisode {
  id: string;
  title: string | null;
  number: number | null;
  isPicked: boolean;
  tags: string[] | null;
  durationSeconds: number | null;
  publishedAt: Date | null;
}

const styles = stylex.create({
  page: { maxWidth: "860px", margin: "0 auto", padding: dimensions.spacing8 },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, marginBottom: dimensions.spacing6 },
  card: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
  },
  head: { display: "flex", alignItems: "center", gap: dimensions.spacing3, marginBottom: dimensions.spacing2 },
  headMeta: { flex: 1, display: "flex", alignItems: "center", gap: dimensions.spacing3, minWidth: 0 },
  episodeTitle: { fontWeight: dimensions.fontWeightMedium, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  number: { color: colors.brand, fontSize: dimensions.fontSizeSm, flexShrink: 0 },
  picked: { color: colors.brand, fontSize: dimensions.fontSizeSm, flexShrink: 0 },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm, marginBottom: dimensions.spacing2 },
  tag: {
    display: "inline-block",
    padding: "2px 8px",
    marginRight: dimensions.spacing1,
    marginBottom: dimensions.spacing1,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.ink,
    color: colors.background,
    fontSize: dimensions.fontSizeSm,
  },
  editBtn: {
    background: "none",
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusSm,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    cursor: "pointer",
    flexShrink: 0,
  },
  form: { display: "flex", flexDirection: "column", gap: dimensions.spacing3, marginTop: dimensions.spacing3 },
  row: { display: "flex", alignItems: "center", gap: dimensions.spacing3 },
  label: { fontSize: dimensions.fontSizeSm, color: colors.neutral, flexShrink: 0 },
  input: {
    flex: 1,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    fontSize: dimensions.fontSizeSm,
    border: `1px solid ${colors.ink}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  checkbox: { width: 16, height: 16, cursor: "pointer" },
  actions: { display: "flex", gap: dimensions.spacing2 },
  saved: { color: colors.brand, fontSize: dimensions.fontSizeSm },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
});

function EpisodeRow(props: { ep: PublishedEpisode }) {
  const { t } = useI18n();
  const [editing, setEditing] = createSignal(false);
  const [tags, setTags] = createSignal(props.ep.tags?.join(", ") ?? "");
  const [picked, setPicked] = createSignal(props.ep.isPicked);
  const [saving, setSaving] = createSignal(false);
  const [saved, setSaved] = createSignal(false);

  const save = async () => {
    setSaving(true);
    try {
      const list = tags().split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8);
      await api.put<{ ok: true }>(`/v1/editor/episodes/${props.ep.id}`, { tags: list, isPicked: picked() });
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // 保存失败保持编辑态，用户可重试
    } finally {
      setSaving(false);
    }
  };

  return (
    <div {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.headMeta)}>
          <span {...stylex.props(styles.number)}>
            {props.ep.number ? t("admin.episodeNumber", { number: props.ep.number }) : ""}
          </span>
          <span {...stylex.props(styles.episodeTitle)}>{props.ep.title || t("common.unnamed")}</span>
        </div>
        {props.ep.isPicked ? <span {...stylex.props(styles.picked)}>★ {t("admin.picked")}</span> : null}
        <button type="button" {...stylex.props(styles.editBtn)} onClick={() => setEditing((v) => !v)}>
          {t("common.edit")}
        </button>
      </div>
      <div {...stylex.props(styles.meta)}>
        {props.ep.publishedAt ? new Date(props.ep.publishedAt).toLocaleString("zh-CN") : ""}
        {props.ep.durationSeconds ? ` · ${Math.round(props.ep.durationSeconds / 60)} min` : ""}
      </div>
      <Show when={props.ep.tags?.length}>
        <For each={props.ep.tags}>
          {(tag) => <span {...stylex.props(styles.tag)}>{tag}</span>}
        </For>
      </Show>
      <Show when={editing()}>
        <div {...stylex.props(styles.form)}>
          <div {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.label)}>{t("admin.epTags")}</span>
            <input
              value={tags()}
              onInput={(e) => setTags(e.currentTarget.value)}
              {...stylex.props(styles.input)}
            />
          </div>
          <div {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.label)}>{t("admin.picked")}</span>
            <input
              type="checkbox"
              checked={picked()}
              onChange={(e) => setPicked(e.currentTarget.checked)}
              {...stylex.props(styles.checkbox)}
            />
            <div {...stylex.props(styles.actions)}>
              <button type="button" {...stylex.props(styles.editBtn)} disabled={saving()} onClick={save}>
                {t("common.save")}
              </button>
              <button type="button" {...stylex.props(styles.editBtn)} onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </button>
              <Show when={saved()}>
                <span {...stylex.props(styles.saved)}>{t("admin.saved")}</span>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

export default function EpisodesPage() {
  const { t } = useI18n();
  const items = createAsync<PublishedEpisode[]>(async () => {
    try {
      const res = await api.get<{ items: PublishedEpisode[] }>("/v1/editor/episodes");
      return res.items;
    } catch {
      return [];
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>{t("admin.publishedEpisodes")}</h1>
      <Show when={items()?.length} fallback={<div {...stylex.props(styles.empty)}>{t("admin.publishedEmpty")}</div>}>
        <For each={items()}>
          {(ep) => <EpisodeRow ep={ep} />}
        </For>
      </Show>
    </div>
  );
}
