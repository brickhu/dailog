// 我的收藏（/me/favorites）：收藏 = 每用户唯一默认列表的聚合视图。
// 存时不分类（一键收藏）；看时前端自动聚合——按 标签 / 语言 / 嘉宾 分组（存储层零分类）。
import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";
import { setFavorite } from "../../lib/favorites";
import { fmtDuration } from "../../lib/format";

/** 收藏条目（/v1/me/favorites 返回；tags/guestName 供前端分组） */
interface FavRow {
  position: number;
  episodeId: string;
  slug: string;
  title: string | null;
  coverUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  language: string;
  audioUrl: string;
  username: string;
  displayName: string;
  callName: string | null;
  guestName: string | null;
  tags: string[] | null;
}

type GroupMode = "all" | "tags" | "language" | "guests";

interface Group {
  label: string;
  items: FavRow[];
}

const styles = stylex.create({
  page: { minHeight: "100vh", backgroundColor: colors.background, color: colors.foreground, fontFamily: "system-ui, -apple-system, sans-serif" },
  content: { maxWidth: "720px", margin: "0 auto", padding: dimensions.spacing8, paddingBottom: "72px" },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, marginBottom: dimensions.spacing1 },
  subtitle: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: "0 0 24px" },
  tabs: { display: "flex", gap: dimensions.spacing2, marginBottom: dimensions.spacing5, flexWrap: "wrap" },
  tab: {
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    color: colors.neutral,
    border: "1px solid",
    borderColor: colors.ink,
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
  },
  tabActive: { backgroundColor: colors.brand, color: colors.onBrand, borderColor: colors.brand },
  groupTitle: { fontSize: dimensions.fontSizeMd, fontWeight: dimensions.fontWeightMedium, margin: "0 0 8px", color: colors.neutral },
  card: {
    padding: dimensions.spacing4, borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface, marginBottom: dimensions.spacing3,
  },
  row: {
    display: "flex", alignItems: "center", gap: dimensions.spacing3,
    padding: dimensions.spacing2, borderRadius: dimensions.radiusSm, backgroundColor: colors.background,
  },
  epTitle: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: dimensions.fontSizeMd, textDecoration: "none", color: "inherit" },
  epMeta: { color: colors.neutral, fontSize: dimensions.fontSizeSm, flexShrink: 0 },
  removeBtn: {
    padding: `${dimensions.spacing1} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: "transparent",
    color: "#e5484d",
    border: "1px solid",
    borderColor: "#e5484d",
    cursor: "pointer",
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
  },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
  hint: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
});

export default function MeFavoritesPage() {
  const { t } = useI18n();
  const [eps, setEps] = createSignal<FavRow[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [mode, setMode] = createSignal<GroupMode>("all");

  const load = async () => {
    try {
      const res = await fetch("/v1/me/favorites");
      if (res.ok) {
        const d = (await res.json()) as { episodes: FavRow[] };
        setEps(d.episodes ?? []);
      }
    } catch { /* 静默 */ }
    setLoaded(true);
  };
  onMount(load);

  const remove = async (episodeId: string) => {
    await setFavorite(episodeId, true); // 已收藏 → 取消
    setEps((prev) => prev.filter((e) => e.episodeId !== episodeId));
  };

  const langLabel = (lang: string) => (lang === "zh" ? "中文" : lang === "en" ? "English" : lang);

  /** 前端聚合：按当前 mode 分组（顺序保持加入倒序） */
  const groups = createMemo<Group[]>(() => {
    const list = eps();
    const m = mode();
    if (list.length === 0) return [];
    if (m === "all") return [{ label: t("favorites.groupAll"), items: list }];
    if (m === "language") {
      const map = new Map<string, FavRow[]>();
      for (const e of list) {
        const k = langLabel(e.language || "zh");
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(e);
      }
      return [...map.entries()].map(([label, items]) => ({ label, items }));
    }
    if (m === "tags") {
      const map = new Map<string, FavRow[]>();
      for (const e of list) {
        const tags = e.tags && e.tags.length > 0 ? e.tags : [t("favorites.untagged")];
        for (const tag of tags) {
          if (!map.has(tag)) map.set(tag, []);
          map.get(tag)!.push(e);
        }
      }
      return [...map.entries()].map(([label, items]) => ({ label, items }));
    }
    // guests
    const map = new Map<string, FavRow[]>();
    for (const e of list) {
      const k = e.guestName ?? t("favorites.noGuest");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  });

  const countLabel = (g: Group) => `${t("playlists.episodeCount", { count: g.items.length })}`;

  return (
    <AuthGate redirect="/me/favorites">
      <div {...stylex.props(layouts.page)}>
        <div {...stylex.props(layouts.containerSm)}>
          <Title>{t("me.favorites")} · dailog</Title>
          <div {...stylex.props(layouts.fullRow, styles.title)}>{t("me.favorites")}</div>
          <p {...stylex.props(layouts.fullRow, styles.subtitle)}>{t("me.favoritesDesc")}</p>

          <div {...stylex.props(layouts.fullRow, styles.tabs)}>
            <For each={[["all", t("favorites.groupAll")], ["tags", t("favorites.groupTags")], ["language", t("favorites.groupLanguages")], ["guests", t("favorites.groupGuests")]] as const}>
              {([key, label]) => (
                <button type="button" {...stylex.props(styles.tab, mode() === key && styles.tabActive)} onClick={() => setMode(key)}>
                  {label}
                </button>
              )}
            </For>
          </div>

          <Show when={loaded()} fallback={<div {...stylex.props(layouts.fullRow, styles.hint)}>{t("common.loading")}</div>}>
            <Show when={eps().length > 0} fallback={<div {...stylex.props(layouts.fullRow, styles.empty)}>{t("favorites.empty")}</div>}>
              <For each={groups()}>
                {(g) => (
                  <div {...stylex.props(layouts.fullRow)}>
                    <h3 {...stylex.props(styles.groupTitle)}>
                      {g.label} · {countLabel(g)}
                    </h3>
                    <div {...stylex.props(styles.card)}>
                      <For each={g.items}>
                        {(ep) => (
                          <div {...stylex.props(styles.row)}>
                            <A href={`/episode/${ep.slug}`} {...stylex.props(styles.epTitle)}>{ep.title ?? t("common.unnamed")}</A>
                            <span {...stylex.props(styles.epMeta)}>
                              {fmtDuration(ep.durationSeconds)}{ep.language ? ` · ${langLabel(ep.language)}` : ""}
                            </span>
                            <button type="button" {...stylex.props(styles.removeBtn)} onClick={() => remove(ep.episodeId)}>{t("favorite.remove")}</button>
                          </div>
                        )}
                      </For>
                    </div>
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