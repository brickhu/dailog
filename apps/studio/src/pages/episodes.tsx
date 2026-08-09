import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";

export interface Episode {
  id: string;
  title: string | null;
  status: "draft" | "generating" | "published" | "failed";
  
  createdAt: string;
}

const STATUS_LABEL: Record<Episode["status"], { text: string; color: string }> = {
  draft: { text: "草稿", color: "#8b95a7" },
  generating: { text: "生成中", color: "#e0a23c" },
  published: { text: "已发布", color: "#3fb68b" },
  failed: { text: "生成失败", color: "#f0506e" },
};

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    backgroundColor: colors.background,
    color: colors.foreground,
  },
  content: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing8,
  },
  hero: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing6,
  },
  heroActions: {
    display: "flex",
    gap: dimensions.spacing3,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
  },
  card: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing3,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing3,
  },
  cardMain: {
    minWidth: 0,
  },
  epTitle: {
    fontWeight: dimensions.fontWeightMedium,
    fontSize: dimensions.fontSizeMd,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  epMeta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
  badge: {
    padding: `2px ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusFull,
    fontSize: "12px",
    flexShrink: 0,
  },
  extCard: {
    padding: dimensions.spacing6,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.ink}`,
    marginBottom: dimensions.spacing6,
  },
  extTitle: {
    fontWeight: dimensions.fontWeightBold,
    marginBottom: dimensions.spacing2,
  },
  extStep: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    lineHeight: 1.7,
    marginBottom: dimensions.spacing1,
  },
  placeholderRow: {
    display: "flex",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing6,
  },
  placeholder: {
    flex: 1,
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px dashed ${colors.ink}`,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textAlign: "center",
  },
  empty: {
    padding: dimensions.spacing12,
    textAlign: "center",
    color: colors.neutral,
    border: `1px dashed ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
  },
  error: {
    color: colors.danger,
    marginBottom: dimensions.spacing3,
  },
});

export default function Dashboard() {
  const navigate = useNavigate();
  const [episodes, setEpisodes] = createSignal<Episode[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      setEpisodes(await api.get<Episode[]>("/api/episodes"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.content)}>
        <div {...stylex.props(styles.hero)}>
          <div {...stylex.props(styles.title)}>我的节目</div>
          <div {...stylex.props(styles.heroActions)}>
            <Button appear="ghost" onClick={() => navigate("/")}>从分享链接导入</Button>
            <Button onClick={() => navigate("/episodes/new")}>开始新节目</Button>
          </div>
        </div>

        <Show when={error()}>
          <div {...stylex.props(styles.error)}>{error()}</div>
        </Show>

        <Show when={!loading() && episodes().length === 0}>
          <div {...stylex.props(styles.empty)}>
            还没有节目。粘贴 AI 对话分享链接（Claude / ChatGPT / DeepSeek / Gemini / Kimi / 豆包），第一期的内容就有了。
          </div>
        </Show>

        <For each={episodes()}>
          {(ep) => {
            const status = STATUS_LABEL[ep.status] ?? STATUS_LABEL.draft;
            return (
              <div {...stylex.props(styles.card)}>
                <div {...stylex.props(styles.cardMain)}>
                  <div {...stylex.props(styles.epTitle)}>{ep.title || "未命名对话"}</div>
                  <div {...stylex.props(styles.epMeta)}>
                    {new Date(ep.createdAt).toLocaleDateString("zh-CN")}
                  </div>
                </div>
                <span
                  {...stylex.props(styles.badge)}
                  style={{ background: `${status.color}22`, color: status.color }}
                >
                  {status.text}
                </span>
              </div>
            );
          }}
        </For>

        <div {...stylex.props(styles.placeholderRow)}>
          <div {...stylex.props(styles.placeholder)}>邀请好友（计划 7）</div>
          <div {...stylex.props(styles.placeholder)}>订阅 Pro（计划 7）</div>
        </div>
      </div>
    </div>
  );
}
