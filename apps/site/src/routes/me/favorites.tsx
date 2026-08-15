import { A, createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";

// 我的收藏（/me/favorites）：收藏的节目列表
interface FavoriteRow {
  episodeId: string;
  slug: string;
  title: string | null;
  audioUrl: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  favoritedAt: string;
}

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
    paddingBottom: "72px", // 播放条高度预留
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing6,
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

export default function FavoritesPage() {
  const { t } = useI18n();
  // 收藏列表：AuthGate 放行后挂载才 fetch（避免登录判定前 401 → 空缓存）
  const favorites = createAsync<FavoriteRow[] | null>(async () => {
    if (typeof window === "undefined") return null;
    const res = await fetch("/v1/me/favorites");
    if (!res.ok) return [];
    return (await res.json()) as FavoriteRow[];
  });

  return (
    <div {...stylex.props(layouts.page)}>
      <Title>{t("me.favorites")} · dailog</Title>
      <AuthGate redirect="/me/favorites">
        <div {...stylex.props(layouts.containerSm)}>
          <div {...stylex.props(layouts.fullRow, styles.title)}>{t("me.favorites")}</div>
          <Show
            when={favorites()?.length}
            fallback={<div {...stylex.props(styles.empty)}>{t("me.empty")}</div>}
          >
            <For each={favorites()}>
              {(fav) => (
                <A href={`/episode/${fav.slug}`} {...stylex.props(styles.card)}>
                  <div {...stylex.props(styles.epTitle)}>{fav.title || t("common.unnamed")}</div>
                  <div {...stylex.props(styles.meta)}>
                    {fav.publishedAt ? new Date(fav.publishedAt).toLocaleDateString("zh-CN") : ""} ·{" "}
                    {fav.durationSeconds ? `${Math.floor(fav.durationSeconds / 60)} 分钟` : ""}
                  </div>
                </A>
              )}
            </For>
          </Show>
        </div>
      </AuthGate>
    </div>
  );
}
