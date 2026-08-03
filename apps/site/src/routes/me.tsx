import { createAsync } from "@solidjs/router";
import { createEffect, For, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { tokens } from "@dailogues/ui/theme.stylex";

// 消费端个人页：dailogues.com/me（收藏列表；登录态经 cookie 判定，未登录跳统一登录）
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
    background: tokens.colorBg,
    color: tokens.colorText,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: tokens.space6,
  },
  title: {
    fontSize: tokens.fontSizeXl,
    fontWeight: tokens.fontWeightBold,
    marginBottom: tokens.space5,
  },
  card: {
    display: "block",
    padding: tokens.space4,
    borderRadius: tokens.radiusMd,
    background: tokens.colorSurface,
    border: `1px solid ${tokens.colorBorder}`,
    marginBottom: tokens.space3,
    textDecoration: "none",
    color: "inherit",
  },
  epTitle: {
    fontWeight: tokens.fontWeightMedium,
    marginBottom: tokens.space1,
  },
  meta: {
    color: tokens.colorTextMuted,
    fontSize: tokens.fontSizeSm,
  },
  empty: {
    color: tokens.colorTextMuted,
    textAlign: "center",
    padding: tokens.space7,
  },
});

export default function MePage() {
  // 会话判定（server 端转发）：未登录 → 统一登录页带 redirect
  const session = createAsync(async () => {
    const res = await fetch("/api/auth/get-session");
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id: string } | null };
    return data.user ?? null;
  });

  const favorites = createAsync<FavoriteRow[] | null>(async () => {
    const user = session();
    if (!user) return null;
    const res = await fetch("/api/me/favorites");
    if (!res.ok) return [];
    return (await res.json()) as FavoriteRow[];
  });

  // 未登录：客户端跳统一登录页（redirect 回 /me）
  createEffect(() => {
    if (typeof window !== "undefined" && session() === null) {
      window.location.href = `/login?redirect=${encodeURIComponent("/me")}`;
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <Title>我的收藏 · dailogues</Title>
      <div {...stylex.props(styles.content)}>
        <Show when={session()}>
          <div {...stylex.props(styles.title)}>我的收藏</div>
          <Show
            when={favorites()?.length}
            fallback={<div {...stylex.props(styles.empty)}>还没有收藏的节目</div>}
          >
            <For each={favorites()}>
              {(fav) => (
                <a href={`/episode/${fav.episodeId}`} {...stylex.props(styles.card)}>
                  <div {...stylex.props(styles.epTitle)}>{fav.title || "未命名节目"}</div>
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
