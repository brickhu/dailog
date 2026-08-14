import { For, Show, createSignal, onMount } from "solid-js";
import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { env } from "../lib/env";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";

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
    border: `1px solid ${colors.ink}`,
    textDecoration: "none",
    color: "inherit",
    textAlign: "center",
    ":hover": { borderColor: colors.primary },
  },
  avatar: { width: "64px", height: "64px", borderRadius: "50%", objectFit: "cover", border: `1px solid ${colors.ink}` },
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
  const [hosts, setHosts] = createSignal<HostRow[]>([]);
  onMount(() => {
    void fetch(`${env.apiBaseUrlPublic ?? env.apiBaseUrl}/v1/public/hosts?limit=20`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => Array.isArray(d) && setHosts(d))
      .catch(() => {});
  });

  return (
    <div {...stylex.props(styles.page)}>
      <Title>{t("hosts.title")} · dailog</Title>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.title)}>{t("hosts.title")}</div>
        <p {...stylex.props(styles.desc)}>{t("hosts.desc")}</p>
        <Show when={hosts().length > 0} fallback={<div {...stylex.props(styles.empty)}>{t("common.loading")}</div>}>
          <div {...stylex.props(styles.grid)}>
            <For each={hosts()}>
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
      </div>
    </div>
  );
}
