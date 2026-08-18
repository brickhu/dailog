import { For, Show, createSignal, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";

// 个人中心（/me）：个人视角首页——用户信息 + 全部功能入口
//   · 账户设置 /settings（资料/昵称/密码/主持人档案/声音采样）
//   · 我的收藏 /me/favorites
//   · 我的投稿 /me/submits
//   · 通知 /me/notifications
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
    marginBottom: dimensions.spacing1,
  },
  subtitle: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: "0 0 24px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: dimensions.spacing4,
  },
  entry: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    textDecoration: "none",
    color: "inherit",
    ":hover": { borderColor: colors.primary },
  },
  entryTitle: {
    fontSize: dimensions.fontSizeLg,
    fontWeight: dimensions.fontWeightMedium,
    margin: 0,
  },
  entryDesc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    margin: 0,
    lineHeight: 1.5,
  },
  avatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover",
    verticalAlign: "middle",
    marginRight: "8px",
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandStrong,
    color: "#fff",
    fontSize: "11px",
    lineHeight: "16px",
    minWidth: "16px",
    textAlign: "center",
    borderRadius: "8px",
    padding: "0 5px",
  },
});

export default function MePage() {
  const { t } = useI18n();
  const [unread, setUnread] = createSignal(0);
  const [profile, setProfile] = createSignal<{ nickname?: string | null; displayName?: string | null; image?: string | null } | null>(null);

  onMount(() => {
    void fetch("/v1/me/notifications/unread")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.count != null && setUnread(d.count))
      .catch(() => {});
    void fetch("/v1/me/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
      .catch(() => {});
  });

  const entries = () => [
    { href: `/${profile()?.nickname ?? "me"}`, title: t("me.hostProfile"), desc: t("me.hostProfileDesc", { name: profile()?.nickname ?? "" }), icon: "🏠" },
    { href: "/settings", title: t("me.settings"), desc: t("me.settingsDesc"), icon: "⚙️" },
    { href: "/me/episodes", title: t("me.episodes"), desc: t("me.episodesDesc"), icon: "🎙️" },
    { href: "/me/playlists", title: t("me.playlists"), desc: t("me.playlistsDesc"), icon: "📃" },
    { href: "/me/submits", title: t("me.submissions"), desc: t("me.submissionsDesc"), icon: "📮" },
    { href: "/me/favorites", title: t("me.favorites"), desc: t("me.favoritesDesc"), icon: "⭐" },
    { href: "/me/notifications", title: t("me.notifications"), desc: t("me.notificationsDesc"), icon: "🔔", badge: unread() > 0 ? (unread() > 99 ? "99+" : unread()) : null },
  ];

  return (
      <AuthGate redirect="/me">
      <div {...stylex.props(layouts.page)}>
        <div {...stylex.props(layouts.containerSm)}>
          <Title>{t("me.title")} · dailog</Title>
          <div {...stylex.props(layouts.fullRow, styles.title)}>{t("me.title")}</div>
          <p {...stylex.props(layouts.fullRow, styles.subtitle)}>
            <Show when={profile()?.image}>
              <img src={profile()!.image!} alt="" {...stylex.props(styles.avatar)} />
            </Show>
            {profile()?.displayName || profile()?.nickname || ""} · @{profile()?.nickname || ""}
          </p>
          <div {...stylex.props(layouts.fullRow, styles.grid)}>
            <For each={entries()}>
              {(e) => (
                <A href={e.href} {...stylex.props(styles.entry)}>
                  <div style={{ "font-size": "22px" }}>{e.icon}</div>
                  <div {...stylex.props(styles.entryTitle)}>
                    {e.title}
                    <Show when={e.badge}>
                      <span {...stylex.props(styles.badge)} style={{ "margin-left": "6px" }}>{e.badge}</span>
                    </Show>
                  </div>
                  <p {...stylex.props(styles.entryDesc)}>{e.desc}</p>
                </A>
              )}
            </For>
          </div>
        </div>
      </div>
      </AuthGate>
  );
}
