import { createAsync } from "@solidjs/router";
import { createEffect, createSignal, For, onMount, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

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

export default function MePage() {
  const { t } = useI18n();
  // 会话判定（server 端转发）：仅 client 执行（SSR 无 cookie；createAsync 序列化结果
  // 会被 hydration 复用不再重取，用 onMount + signal 保证挂载后必然重新判定）
  const [session, setSession] = createSignal<{ id: string } | null>(null);
  const [checked, setChecked] = createSignal(false);
  onMount(async () => {
    const res = await fetch("/v1/auth/get-session");
    if (res.ok) {
      // better-auth 未登录返回 JSON null（代理透传）——必须整体可选链
      const data = (await res.json()) as { user?: { id: string } | null } | null;
      setSession(data?.user ?? null);
    }
    setChecked(true);
  });

  const favorites = createAsync<FavoriteRow[] | null>(async () => {
    const user = session();
    if (!user) return null;
    const res = await fetch("/v1/me/favorites");
    if (!res.ok) return [];
    return (await res.json()) as FavoriteRow[];
  });

  // 未登录：客户端跳统一登录页（redirect 回 /me）；等会话判定完成后才跳
  createEffect(() => {
    if (checked() && session() === null) {
      window.location.href = `/login?redirect=${encodeURIComponent("/me")}`;
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <Title>{t("me.title")} · dailog</Title>
      <div {...stylex.props(styles.content)}>
        <Show when={session()}>
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
        </Show>
      </div>
    </div>
  );
}
