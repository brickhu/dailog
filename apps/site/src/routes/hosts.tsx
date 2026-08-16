import { For, Show, Suspense, createResource } from "solid-js";
import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { apiBaseForFetch } from "../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { ListSkeleton } from "../components/route-skeletons";

// 主播列表（/hosts）：在 Dailog 出过节目的主持人（按播放量 + 期数排序）
interface HostRow { username: string; displayName: string; avatar: string | null; episodeCount: number; totalPlays: number; }

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: "system-ui, -apple-system, sans-serif",
    paddingBottom: "72px",
  },
  content: {
    maxWidth: "1080px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, margin: "0 0 4px" },
  desc: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: "0 0 24px" },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: dimensions.spacing4,
    "@media (max-width: 640px)": { gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" },
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: dimensions.spacing2,
    padding: dimensions.spacing5,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    textDecoration: "none",
    color: "inherit",
    textAlign: "center",
    ":hover": { borderColor: colors.primary },
  },
  avatar: {
    width: "64px", height: "64px", borderRadius: "50%", objectFit: "cover",
  },
  avatarFallback: {
    width: "64px", height: "64px", borderRadius: "50%", backgroundColor: colors.ink,
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: dimensions.fontSize2xl,
  },
  name: { fontSize: dimensions.fontSizeLg, fontWeight: dimensions.fontWeightMedium, margin: 0 },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: 0 },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
});

export default function HostsPage() {
  const { t } = useI18n();
  // 列表数据：createResource（SSR 服务端 fetch + 序列化，hydration 直接用）
  const [hosts] = createResource(async () => {
    const r = await fetch(`${apiBaseForFetch}/v1/public/hosts?limit=20`);
    const d: unknown = r.ok ? await r.json() : null;
    return Array.isArray(d) ? (d as HostRow[]) : [];
  });

  return (
      <div {...stylex.props(layouts.containerLg)}>
        <div {...stylex.props(layouts.fullRow, styles.title)}>{t("hosts.title")}</div>
        <Title>{t("hosts.title")} · dailog</Title>
        <p {...stylex.props(layouts.fullRow, styles.desc)}>{t("hosts.desc")}</p>
        <div {...stylex.props(layouts.fullRow)}>
        <Suspense fallback={<ListSkeleton />}>
        <Show when={hosts()?.length} fallback={<ListSkeleton />}>
          <div {...stylex.props(styles.grid)}>
            <For each={hosts() ?? []}>
              {(h) => (
                <A href={`/@${h.username}`} {...stylex.props(styles.card)}>
                  <Show when={h.avatar} fallback={<div {...stylex.props(styles.avatarFallback)}>{h.displayName.slice(0, 1)}</div>}>
                    <img src={h.avatar!} alt="" {...stylex.props(styles.avatar)} />
                  </Show>
                  <div {...stylex.props(styles.name)}>{h.displayName}</div>
                  <div {...stylex.props(styles.meta)}>@{h.username} · {h.episodeCount} 期 · {h.totalPlays} 播放</div>
                </A>
              )}
            </For>
          </div>
        </Show>
        </Suspense>
        </div>
      </div>
  );
}
