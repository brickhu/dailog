import { For, Show, createSignal, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";

// 我的播放列表（/me/playlists）：创建 / 编辑 / 删除 / 公开分享 / 展开管理条目
interface MyPlaylist {
  id: string;
  slug: string;
  kind: string;
  ownerId: string | null;
  title: string;
  description: string | null;
  language: string;
  isPublic: boolean;
  isPicked: boolean;
  createdAt: string;
  updatedAt: string;
  episodeCount: number;
  contains: boolean;
}

interface PlaylistEpRow {
  position: number;
  episodeId: string;
  slug: string;
  title: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  username: string;
  displayName: string;
}

const styles = stylex.create({
  page: { minHeight: "100vh", backgroundColor: colors.background, color: colors.foreground, fontFamily: "system-ui, -apple-system, sans-serif" },
  content: { maxWidth: "720px", margin: "0 auto", padding: dimensions.spacing8, paddingBottom: "72px" },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, marginBottom: dimensions.spacing1 },
  subtitle: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: "0 0 24px" },
  form: {
    display: "flex", flexDirection: "column", gap: dimensions.spacing3,
    padding: dimensions.spacing5, borderRadius: dimensions.radiusMd, backgroundColor: colors.surface, marginBottom: dimensions.spacing6,
  },
  input: {
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: "1px solid",
    borderColor: colors.ink,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
  },
  textarea: {
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: "1px solid",
    borderColor: colors.ink,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    resize: "vertical",
    minHeight: "56px",
  },
  row: {
    display: "flex", alignItems: "center", gap: dimensions.spacing3,
  },
  checkLabel: { display: "flex", alignItems: "center", gap: dimensions.spacing2, fontSize: dimensions.fontSizeSm, color: colors.neutral },
  createBtn: {
    padding: `${dimensions.spacing2} ${dimensions.spacing5}`,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.brand, color: colors.onBrand,
    border: "none", cursor: "pointer", fontWeight: dimensions.fontWeightMedium,
    width: "fit-content",
  },
  card: {
    padding: dimensions.spacing4, borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface, marginBottom: dimensions.spacing3,
  },
  cardHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: dimensions.spacing2 },
  cardTitle: { fontSize: dimensions.fontSizeLg, fontWeight: dimensions.fontWeightMedium, margin: 0 },
  badge: {
    fontSize: "11px", lineHeight: "16px", padding: "0 8px", borderRadius: dimensions.radiusFull,
    backgroundColor: colors.ink, color: colors.foreground, flexShrink: 0,
  },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: "4px 0 8px" },
  actions: { display: "flex", gap: dimensions.spacing2, flexWrap: "wrap" },
  actionBtn: {
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: "transparent",
    color: colors.neutral,
    border: "1px solid",
    borderColor: colors.ink,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
  },
  dangerBtn: { color: "#e5484d", borderColor: "#e5484d" },
  episodes: { marginTop: dimensions.spacing3, display: "flex", flexDirection: "column", gap: dimensions.spacing2 },
  epRow: {
    display: "flex", alignItems: "center", gap: dimensions.spacing3,
    padding: dimensions.spacing2, borderRadius: dimensions.radiusSm, backgroundColor: colors.background,
  },
  epTitle: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: dimensions.fontSizeMd },
  epMeta: { color: colors.neutral, fontSize: dimensions.fontSizeSm, flexShrink: 0 },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
  hint: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
});

export default function MePlaylistsPage() {
  const { t } = useI18n();
  const [list, setList] = createSignal<MyPlaylist[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");
  const [newDesc, setNewDesc] = createSignal("");
  const [newPublic, setNewPublic] = createSignal(true);
  const [creating, setCreating] = createSignal(false);
  const [expandedId, setExpandedId] = createSignal<string | null>(null);
  const [episodes, setEpisodes] = createSignal<PlaylistEpRow[] | null>(null);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editTitle, setEditTitle] = createSignal("");
  const [editDesc, setEditDesc] = createSignal("");
  const [editPublic, setEditPublic] = createSignal(true);
  const [copiedSlug, setCopiedSlug] = createSignal<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/v1/me/playlists");
      if (res.ok) setList((await res.json()) as MyPlaylist[]);
    } catch { /* 静默 */ }
    setLoaded(true);
  };

  onMount(load);

  const create = async () => {
    const title = newTitle().trim();
    if (!title) return;
    setCreating(true);
    try {
      await fetch("/v1/me/playlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description: newDesc().trim() || null, isPublic: newPublic() }),
      });
      setNewTitle(""); setNewDesc("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const toggleExpand = async (pl: MyPlaylist) => {
    if (expandedId() === pl.id) {
      setExpandedId(null); setEpisodes(null);
      return;
    }
    setExpandedId(pl.id);
    setEpisodes(null);
    try {
      const res = await fetch(`/v1/me/playlists/${pl.id}`);
      if (res.ok) {
        const d = (await res.json()) as { episodes: PlaylistEpRow[] };
        setEpisodes(d.episodes ?? []);
      }
    } catch { setEpisodes([]); }
  };

  const startEdit = (pl: MyPlaylist) => {
    setEditingId(pl.id);
    setEditTitle(pl.title);
    setEditDesc(pl.description ?? "");
    setEditPublic(pl.isPublic);
  };

  const saveEdit = async (id: string) => {
    await fetch(`/v1/me/playlists/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: editTitle().trim() || undefined, description: editDesc().trim() || null, isPublic: editPublic() }),
    });
    setEditingId(null);
    await load();
  };

  const remove = async (pl: MyPlaylist) => {
    if (!window.confirm(t("playlist.deleteConfirm", { title: pl.title }))) return;
    await fetch(`/v1/me/playlists/${pl.id}`, { method: "DELETE" });
    if (expandedId() === pl.id) { setExpandedId(null); setEpisodes(null); }
    await load();
  };

  const removeEpisode = async (plId: string, episodeId: string) => {
    await fetch(`/v1/me/playlists/${plId}/episodes/${episodeId}`, { method: "DELETE" });
    await load();
    const res = await fetch(`/v1/me/playlists/${plId}`);
    if (res.ok) setEpisodes(((await res.json()) as { episodes: PlaylistEpRow[] }).episodes ?? []);
  };

  const share = async (pl: MyPlaylist) => {
    if (!pl.isPublic) return;
    const url = `${window.location.origin}/playlist/${pl.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(pl.slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch { /* 剪贴板不可用静默 */ }
  };

  return (
    <AuthGate redirect="/me/playlists">
      <div {...stylex.props(layouts.page)}>
        <div {...stylex.props(layouts.containerSm)}>
          <Title>{t("me.playlists")} · dailog</Title>
          <div {...stylex.props(layouts.fullRow, styles.title)}>{t("me.playlists")}</div>
          <p {...stylex.props(layouts.fullRow, styles.subtitle)}>{t("me.playlistsDesc")}</p>

          {/* 新建列表 */}
          <div {...stylex.props(layouts.fullRow, styles.form)}>
            <input
              type="text" value={newTitle()} placeholder={t("playlist.newTitlePlaceholder")}
              onInput={(e) => setNewTitle(e.currentTarget.value)} {...stylex.props(styles.input)}
            />
            <textarea
              value={newDesc()} placeholder={t("playlist.newDescPlaceholder")}
              onInput={(e) => setNewDesc(e.currentTarget.value)} {...stylex.props(styles.textarea)}
            />
            <div {...stylex.props(styles.row)}>
              <label {...stylex.props(styles.checkLabel)}>
                <input type="checkbox" checked={newPublic()} onChange={(e) => setNewPublic(e.currentTarget.checked)} />
                {t("playlist.public")}（{t("playlist.publicHint")}）
              </label>
              <button type="button" {...stylex.props(styles.createBtn)} disabled={creating()} onClick={create}>
                {creating() ? "…" : t("playlist.create")}
              </button>
            </div>
          </div>

          <Show when={loaded()} fallback={<div {...stylex.props(layouts.fullRow, styles.hint)}>{t("common.loading")}</div>}>
            <Show when={list().length > 0} fallback={<div {...stylex.props(layouts.fullRow, styles.empty)}>{t("playlists.empty")}</div>}>
              <For each={list()}>
                {(pl) => (
                  <div {...stylex.props(layouts.fullRow, styles.card)}>
                    <div {...stylex.props(styles.cardHead)}>
                      <h3 {...stylex.props(styles.cardTitle)}>{pl.title}</h3>
                      <span {...stylex.props(styles.badge)}>{pl.isPublic ? t("playlist.public") : t("playlist.private")}</span>
                    </div>
                    <p {...stylex.props(styles.meta)}>
                      {t("playlists.episodeCount", { count: pl.episodeCount })}
                      {pl.description ? " · " + pl.description : ""}
                    </p>
                    <div {...stylex.props(styles.actions)}>
                      <button type="button" {...stylex.props(styles.actionBtn)} onClick={() => toggleExpand(pl)}>
                        {expandedId() === pl.id ? t("common.cancel") : t("playlist.episodes")}
                      </button>
                      <button type="button" {...stylex.props(styles.actionBtn)} onClick={() => startEdit(pl)}>{t("playlist.edit")}</button>
                      <button type="button" {...stylex.props(styles.actionBtn)} onClick={() => share(pl)} disabled={!pl.isPublic}>
                        {copiedSlug() === pl.slug ? t("playlist.copied") : t("playlist.share")}
                      </button>
                      <button type="button" {...stylex.props(styles.actionBtn, styles.dangerBtn)} onClick={() => remove(pl)}>{t("playlist.delete")}</button>
                    </div>

                    {/* 编辑态 */}
                    <Show when={editingId() === pl.id}>
                      <div {...stylex.props(styles.form)}>
                        <input type="text" value={editTitle()} onInput={(e) => setEditTitle(e.currentTarget.value)} {...stylex.props(styles.input)} />
                        <textarea value={editDesc()} onInput={(e) => setEditDesc(e.currentTarget.value)} {...stylex.props(styles.textarea)} />
                        <div {...stylex.props(styles.row)}>
                          <label {...stylex.props(styles.checkLabel)}>
                            <input type="checkbox" checked={editPublic()} onChange={(e) => setEditPublic(e.currentTarget.checked)} />
                            {t("playlist.public")}（{t("playlist.publicHint")}）
                          </label>
                          <button type="button" {...stylex.props(styles.createBtn)} onClick={() => saveEdit(pl.id)}>{t("common.save")}</button>
                        </div>
                      </div>
                    </Show>

                    {/* 展开条目 */}
                    <Show when={expandedId() === pl.id}>
                      <div {...stylex.props(styles.episodes)}>
                        <Show when={episodes() !== null && episodes()!.length > 0} fallback={<div {...stylex.props(styles.hint)}>{t("playlist.emptyEpisodes")}</div>}>
                          <For each={episodes()}>
                            {(ep) => (
                              <div {...stylex.props(styles.epRow)}>
                                <A href={`/episode/${ep.slug}`} {...stylex.props(styles.epTitle)}>{ep.title ?? t("common.unnamed")}</A>
                                <span {...stylex.props(styles.epMeta)}>
                                  {ep.durationSeconds ? Math.floor(ep.durationSeconds / 60) + t("common.minutes") : ""}
                                </span>
                                <button type="button" {...stylex.props(styles.actionBtn)} onClick={() => removeEpisode(pl.id, ep.episodeId)}>{t("playlist.remove")}</button>
                              </div>
                            )}
                          </For>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </AuthGate>
  );
}
