import { A, createAsync } from "@solidjs/router";
import { For, Show, createSignal } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";

// 我的节目（/me/episodes）：已发布节目列表 + 下架/重新上架（切换 isPublic）。
// 下架后从首页/RSS/公开接口消失，仅自己可见。
interface MyEpisode {
  id: string;
  slug: string;
  title: string | null;
  number: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  isPublic: boolean;
  isPicked: boolean;
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
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing2,
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "baseline",
    gap: dimensions.spacing2,
    flexWrap: "wrap",
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
  },
  badge: {
    padding: "2px 8px",
    borderRadius: dimensions.radiusFull,
    fontSize: "12px",
    border: "none",
  },
  badgePublic: {
    backgroundColor: colors.surfaceStrong,
    color: colors.foreground,
  },
  badgeUnlisted: {
    backgroundColor: colors.surfaceStrong,
    color: colors.neutral,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
  },
  actionBtn: {
    padding: `${dimensions.spacing1} ${dimensions.spacing4}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: "transparent",
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    ":hover": { opacity: 0.8 },
  },
  unpublishBtn: {
    color: colors.danger,
  },
  republishBtn: {
    color: colors.primary,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
  submitLink: {
    color: colors.primary,
    textDecoration: "none",
    marginLeft: dimensions.spacing2,
  },
});

function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 数据列表组件：仅在 AuthGate 放行后渲染（挂载时才 fetch）——
// createAsync 若在页面组件顶层执行，会在 AuthGate 判定登录前发起请求（401 → [] 被缓存，放行后不再重取）
function EpisodesList() {
  const { t } = useI18n();
  const [episodes, setEpisodes] = createSignal<MyEpisode[] | null>(null);
  createAsync<MyEpisode[] | null>(async () => {
    // SSR 首帧短路：相对路径在服务端无法解析（Node fetch 需绝对 URL）
    if (typeof window === "undefined") return null;
    const res = await fetch("/v1/me/episodes");
    if (!res.ok) return [];
    const list = (await res.json()) as MyEpisode[];
    setEpisodes(list);
    return list;
  });

  // 下架/重新上架：PATCH 成功后本地更新（不整页刷新）
  const togglePublic = async (ep: MyEpisode) => {
    const next = !ep.isPublic;
    const res = await fetch(`/v1/me/episodes/${ep.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: next }),
    });
    if (!res.ok) return;
    setEpisodes((prev) => prev?.map((e) => (e.id === ep.id ? { ...e, isPublic: next } : e)) ?? null);
  };

  return (
    <div {...stylex.props(layouts.containerSm)}>
      <div {...stylex.props(layouts.fullRow, styles.title)}>{t("me.episodes")}</div>
      <Show
        when={episodes()?.length}
        fallback={
          <div {...stylex.props(styles.empty)}>
            <span>{t("me.episodesEmpty")}</span>
            <A href="/submit" {...stylex.props(styles.submitLink)}>{t("meSubmits.submit")} →</A>
          </div>
        }
      >
        <For each={episodes()}>
          {(ep) => (
            <div {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.cardTitleRow)}>
                <A href={`/episode/${ep.slug}`} style={{ color: "inherit", "text-decoration": "none" }}>
                  <span {...stylex.props(styles.epTitle)}>{ep.title || t("common.unnamed")}</span>
                </A>
                <span {...stylex.props(styles.badge, ep.isPublic ? styles.badgePublic : styles.badgeUnlisted)}>
                  {ep.isPublic ? t("me.statusPublic") : t("me.statusUnlisted")}
                </span>
              </div>
              <div {...stylex.props(styles.meta)}>
                {ep.number ? `第 ${ep.number} 期` : ""}
                {ep.publishedAt ? ` · ${new Date(ep.publishedAt).toLocaleDateString("zh-CN")}` : ""}
                {ep.durationSeconds ? ` · ${fmtDuration(ep.durationSeconds)}` : ""}
              </div>
              <div {...stylex.props(styles.actions)}>
                <button
                  type="button"
                  {...stylex.props(styles.actionBtn, ep.isPublic ? styles.unpublishBtn : styles.republishBtn)}
                  onClick={() => togglePublic(ep)}
                >
                  {ep.isPublic ? t("me.unpublish") : t("me.republish")}
                </button>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export default function MeEpisodesPage() {
  const { t } = useI18n();
  return (
      <AuthGate redirect="/me/episodes">
        <Title>{t("me.episodes")} · dailog</Title>
        <EpisodesList />
      </AuthGate>
  );
}
