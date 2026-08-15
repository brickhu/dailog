import { For, Show, Suspense, createResource } from "solid-js";
import { A } from "@solidjs/router";
import { Title } from "@solidjs/meta";
import { apiBaseForFetch } from "../lib/env";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { ListSkeleton } from "../components/route-skeletons";

// 常驻 AI 嘉宾（/guests）：品牌声线宿主列表
interface GuestRow { id: string; platform: string; name: string; avatar: string | null; intro: string | null; url: string | null; }

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
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm, margin: 0, lineHeight: 1.5 },
  empty: { color: colors.neutral, textAlign: "center", padding: dimensions.spacing12 },
});

export default function GuestsPage() {
  const { t } = useI18n();
  // 列表数据：createResource（SSR 服务端 fetch + 序列化，hydration 直接用）
  const [guests] = createResource(async () => {
    const r = await fetch(`${apiBaseForFetch}/v1/public/guests`);
    const d: unknown = r.ok ? await r.json() : null;
    return Array.isArray(d) ? (d as GuestRow[]) : [];
  });

  return (
    <div {...stylex.props(layouts.page)}>
      <Title>{t("guests.title")} · dailog</Title>
      <div {...stylex.props(layouts.containerLg)}>
        <div {...stylex.props(layouts.fullRow, styles.title)}>{t("guests.title")}</div>
        <p {...stylex.props(layouts.fullRow, styles.desc)}>{t("guests.desc")}</p>
        <div {...stylex.props(layouts.fullRow)}>
        <Suspense fallback={<ListSkeleton />}>
        <Show when={guests()?.length} fallback={<ListSkeleton />}>
          <div {...stylex.props(styles.grid)}>
            <For each={guests() ?? []}>
              {(g) => (
                <A href={`/guest/${g.id}`} {...stylex.props(styles.card)}>
                  <Show when={g.avatar} fallback={<div {...stylex.props(styles.avatarFallback)}>{g.name.slice(0, 1)}</div>}>
                    <img src={g.avatar!} alt="" {...stylex.props(styles.avatar)} />
                  </Show>
                  <div {...stylex.props(styles.name)}>{g.name}</div>
                  <div {...stylex.props(styles.meta)}>{g.platform}{g.intro ? ` · ${g.intro.slice(0, 40)}` : ""}</div>
                </A>
              )}
            </For>
          </div>
        </Show>
        </Suspense>
        </div>
      </div>
    </div>
  );
}
