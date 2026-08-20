// 「加入播放列表」：弹窗（我的列表勾选/取消 + 新建即收）+ 一体按钮。
// - AddToPlaylistDialog：受控弹窗面板（isOpen/onOpenChange）——页面需要"按钮在外面、
//   面板抽组件"（如节目详情页）时用这个；内部维护列表加载/勾选/新建。
// - AddToPlaylist：按钮 + 弹窗一体（首页详情面板等直接用）。
// 未登录 → 跳登录页。数据走 site 同源 /v1/me/playlists* 代理（cookie 会话透传）。
import { For, Show, createEffect, createSignal } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button, Dialog, Icon } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

interface MyPlaylist {
  id: string;
  slug: string;
  title: string;
  episodeCount: number;
  isPublic: boolean;
  /** 系统内置「我的收藏」默认列表（置顶展示，标题用 i18n） */
  isDefault: boolean;
  contains: boolean;
}

const styles = stylex.create({
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: dimensions.spacing2,
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: colors.foreground,
    border: "1px solid",
    borderColor: colors.ink,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    ":hover": { borderColor: colors.primary },
  },
  list: { display: "flex", flexDirection: "column", gap: dimensions.spacing2 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
    padding: dimensions.spacing3,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
  },
  rowTitle: { fontWeight: dimensions.fontWeightMedium, fontSize: dimensions.fontSizeMd },
  rowMeta: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
  toggle: {
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: "1px solid",
    borderColor: colors.ink,
    backgroundColor: "transparent",
    color: colors.foreground,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
  },
  toggleOn: { backgroundColor: colors.brand, color: colors.onBrand, borderColor: colors.brand },
  newRow: {
    display: "flex",
    gap: dimensions.spacing2,
    marginTop: dimensions.spacing3,
  },
  input: {
    flex: 1,
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    border: "1px solid",
    borderColor: colors.ink,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
  },
  create: {
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.brand,
    color: colors.onBrand,
    border: "none",
    cursor: "pointer",
    fontWeight: dimensions.fontWeightMedium,
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
  },
  empty: { color: colors.neutral, fontSize: dimensions.fontSizeSm, textAlign: "center", padding: dimensions.spacing6 },
  hint: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
});

/** 加入播放列表弹窗（受控）：我的列表勾选/取消 + 新建即收 */
export function AddToPlaylistDialog(props: {
  episodeId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => unknown;
}) {
  const { t } = useI18n();
  const [list, setList] = createSignal<MyPlaylist[] | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [unauthorized, setUnauthorized] = createSignal(false);

  const load = async () => {
    const res = await fetch(`/v1/me/playlists?contains=${props.episodeId}`);
    if (res.status === 401) {
      setUnauthorized(true);
      setList([]);
      return;
    }
    setUnauthorized(false);
    if (res.ok) {
      const rows = (await res.json()) as MyPlaylist[];
      // 默认列表（我的收藏）置顶
      setList([...rows.filter((p) => p.isDefault), ...rows.filter((p) => !p.isDefault)]);
    }
  };

  // 每次打开时拉取最新列表（勾选状态/新建后刷新）
  createEffect(() => {
    if (props.isOpen) void load();
  });

  const toggle = async (pl: MyPlaylist) => {
    setBusy(true);
    try {
      if (pl.contains) {
        await fetch(`/v1/me/playlists/${pl.id}/episodes/${props.episodeId}`, { method: "DELETE" });
      } else {
        await fetch(`/v1/me/playlists/${pl.id}/episodes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ episodeId: props.episodeId }),
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const title = newTitle().trim();
    if (!title) return;
    setCreating(true);
    try {
      const res = await fetch("/v1/me/playlists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, isPublic: true }),
      });
      if (res.ok) {
        const created = (await res.json()) as { id: string };
        await fetch(`/v1/me/playlists/${created.id}/episodes`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ episodeId: props.episodeId }),
        });
        setNewTitle("");
        await load();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog isOpen={props.isOpen} onOpenChange={props.onOpenChange} width={360} padding={5}>
      <h3 style={{ margin: "0 0 12px", "font-size": "16px" }}>{t("playlist.addTo")}</h3>
      <Show
        when={unauthorized()}
        fallback={
          <Show when={list() !== null} fallback={<div {...stylex.props(styles.empty)}>{t("common.loading")}</div>}>
            <Show when={list()!.length > 0} fallback={<div {...stylex.props(styles.empty)}>{t("playlists.empty")}</div>}>
              <div {...stylex.props(styles.list)}>
                <For each={list()}>
                  {(pl) => (
                    <div {...stylex.props(styles.row)}>
                      <div>
                        <div {...stylex.props(styles.rowTitle)}>{pl.isDefault ? t("me.favorites") : pl.title}</div>
                        <div {...stylex.props(styles.rowMeta)}>
                          {t("playlists.episodeCount", { count: pl.episodeCount })} · {pl.isPublic ? t("playlist.public") : t("playlist.private")}
                        </div>
                      </div>
                      <button
                        type="button"
                        {...stylex.props(styles.toggle, pl.contains && styles.toggleOn)}
                        disabled={busy()}
                        onClick={() => toggle(pl)}
                      >
                        {pl.contains ? t("playlist.added") : t("playlist.addTo")}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        }
      >
        <p {...stylex.props(styles.empty)}>
          <a href="/login" style={{ color: colors.primary }}>{t("playlist.loginHint")}</a>
        </p>
      </Show>
      <div {...stylex.props(styles.newRow)}>
        <input
          type="text"
          value={newTitle()}
          placeholder={t("playlist.newTitlePlaceholder")}
          onInput={(e) => setNewTitle(e.currentTarget.value)}
          {...stylex.props(styles.input)}
        />
        <button type="button" {...stylex.props(styles.create)} disabled={creating()} onClick={createAndAdd}>
          {creating() ? "…" : t("playlist.create")}
        </button>
      </div>
    </Dialog>
  );
}

/** 加入播放列表按钮 + 弹窗一体（首页详情面板等直接用） */
export function AddToPlaylist(props: { episodeId: string; iconOnly?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  return (
    <>
      {props.iconOnly ? (
        <Button
          isIconOnly
          icon={<Icon icon="mdi:playlist-plus" width={20} />}
          appear="outline"
          size="lg"
          round="full"
          label={t("playlist.addTo")}
          tooltip={t("playlist.addTo")}
          onClick={() => setOpen(true)}
        />
      ) : (
        <button type="button" {...stylex.props(styles.button)} onClick={() => setOpen(true)}>
          + {t("playlist.addTo")}
        </button>
      )}
      <AddToPlaylistDialog episodeId={props.episodeId} isOpen={open()} onOpenChange={setOpen} />
    </>
  );
}
