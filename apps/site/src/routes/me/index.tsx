import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";

// 消费端个人页：dailog.fm/me（收藏列表；登录态经 cookie 判定，未登录跳统一登录）
interface FavoriteRow {
  episodeId: string;
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
    border: `1px solid ${colors.ink}`,
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

// 收藏列表组件：仅在 AuthGate 放行后渲染（挂载时才 fetch）——
// createAsync 在页面组件顶层执行会在登录判定前发起请求（401 → [] 缓存，放行后不再重取）
function FavoritesList() {
  const { t } = useI18n();
  const favorites = createAsync<FavoriteRow[] | null>(async () => {
    if (typeof window === "undefined") return null;
    const res = await fetch("/v1/me/favorites");
    if (!res.ok) return [];
    return (await res.json()) as FavoriteRow[];
  });

  return (
    <div {...stylex.props(styles.content)}>
      <div {...stylex.props(styles.title)}>{t("me.title")}</div>
      <Show
        when={favorites()?.length}
        fallback={<div {...stylex.props(styles.empty)}>{t("me.empty")}</div>}
      >
        <For each={favorites()}>
          {(fav) => (
            <a href={`/episode/${fav.episodeId}`} {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.epTitle)}>{fav.title || t("common.unnamed")}</div>
              <div {...stylex.props(styles.meta)}>
                {fav.publishedAt ? new Date(fav.publishedAt).toLocaleDateString("zh-CN") : ""} ·{" "}
                {fav.durationSeconds ? `${Math.floor(fav.durationSeconds / 60)} 分钟` : ""}
              </div>
            </a>
          )}
        </For>
      </Show>
    </div>
  );
}

export default function MePage() {
  const { t } = useI18n();
  return (
    <div {...stylex.props(styles.page)}>
      <Title>{t("me.title")} · dailog</Title>
      <AuthGate redirect="/me">
        <FavoritesList />
      </AuthGate>
    </div>
  );
}
