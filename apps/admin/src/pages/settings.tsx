import { createAsync } from "@solidjs/router";
import { For } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { useI18n } from "@dailogues/i18n";

// 嘉宾管理：列表 + 采样（P3d：采样上传后续补充）
interface GuestRow { id: string; platform: string; name: string; intro: string | null; }
interface SampleRow { id: string; guestId: string; language: string; }

const styles = stylex.create({
  page: { maxWidth: "720px", margin: "0 auto", padding: dimensions.spacing8 },
  title: { fontSize: dimensions.fontSize2xl, fontWeight: dimensions.fontWeightBold, marginBottom: dimensions.spacing6 },
  card: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
  },
  name: { fontWeight: dimensions.fontWeightMedium, marginBottom: dimensions.spacing1 },
  meta: { color: colors.neutral, fontSize: dimensions.fontSizeSm },
});

export default function SettingsPage() {
  const { t } = useI18n();
  const data = createAsync<{ guests: GuestRow[]; samples: SampleRow[] } | null>(async () => {
    try {
      return await api.get<{ guests: GuestRow[]; samples: SampleRow[] }>("/v1/editor/guests");
    } catch {
      return null;
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.title)}>{t("admin.guests")}</div>
      <For each={data()?.guests ?? []}>
        {(g) => (
          <div {...stylex.props(styles.card)}>
            <div {...stylex.props(styles.name)}>{g.name}</div>
            <div {...stylex.props(styles.meta)}>
              {g.platform} · {g.intro ?? ""}
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
