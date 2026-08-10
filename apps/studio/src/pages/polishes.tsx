import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@dailogues/ui";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { api } from "../lib/client";
import { useI18n } from "@dailogues/i18n";

// /polishes：脚本列表——按对话（polish）分组展示：
//   <对话标题> - from <AI 平台>
//   #1 : <脚本标题> - <已生成/未生成>
// 点击脚本行进入编辑页并直达该脚本（?script=<id>）。

interface ScriptItem {
  id: string;
  title: string | null;
  topic: string | null;
  /** unused = 未生成节目；used = 已生成 */
  status: string | null;
}

interface PolishItem {
  id: string;
  title: string | null;
  status: string;
  snapshotTitle: string | null;
  /** 对话来源平台（claude/chatgpt/...）+ 展示名（guests 表，如 DeepSeek） */
  platform: string | null;
  aiName: string | null;
  scripts: ScriptItem[];
  episodeId: string | null;
  episodeStatus: string | null;
  createdAt: string;
}

const styles = stylex.create({
  page: {
    maxWidth: "720px",
    margin: "0 auto",
    padding: dimensions.spacing6,
    color: colors.foreground,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing6,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
  },
  subtitle: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
  group: {
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    border: `1px solid ${colors.ink}`,
    backgroundColor: colors.surface,
  },
  groupHeader: {
    display: "flex",
    alignItems: "baseline",
    gap: dimensions.spacing1,
    marginBottom: dimensions.spacing3,
    cursor: "pointer",
  },
  groupTitle: {
    fontWeight: dimensions.fontWeightBold,
    fontSize: dimensions.fontSizeMd,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  groupFrom: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
  },
  divider: {
    border: "none",
    borderTop: `1px dashed ${colors.ink}`,
    margin: `${dimensions.spacing4} 0`,
  },
  scriptRow: {
    display: "flex",
    alignItems: "baseline",
    gap: dimensions.spacing2,
    padding: `${dimensions.spacing2} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    cursor: "pointer",
    fontSize: dimensions.fontSizeMd,
  },
  scriptNum: {
    color: colors.neutral,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  scriptTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  scriptStatus: {
    fontSize: dimensions.fontSizeSm,
    flexShrink: 0,
    padding: `1px ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusFull,
    backgroundColor: colors.surfaceWeak,
    color: colors.neutralWeak,
  },
  scriptUsed: {
    backgroundColor: "#dcfce7",
    color: "#166534",
  },
  noScript: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    padding: `${dimensions.spacing2} 0`,
  },
  empty: {
    padding: dimensions.spacing8,
    textAlign: "center",
    color: colors.neutral,
    border: `1px dashed ${colors.ink}`,
    borderRadius: dimensions.radiusMd,
  },
  emptyAction: {
    marginTop: dimensions.spacing4,
  },
  error: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing3,
  },
});

export default function PolishesPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = createSignal<PolishItem[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    try {
      const list = await api.get<PolishItem[]>("/v1/polishes");
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("studio.loadFailed"));
    } finally {
      setLoading(false);
    }
  });

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <div>
          <div {...stylex.props(styles.title)}>{t("studio.scripts")}</div>
          <div {...stylex.props(styles.subtitle)}>
            你的创作容器——每个容器基于一份对话快照，可生成多条润色脚本
          </div>
        </div>
        <Button onClick={() => navigate("/")}>{t("studio.importFromLink")}</Button>
      </header>

      <Show when={loading()}>
        <div {...stylex.props(styles.subtitle)}>{t("common.loading")}</div>
      </Show>
      <Show when={error()}>
        <div {...stylex.props(styles.error)}>{error()}</div>
      </Show>

      <Show when={!loading() && !error() && items().length === 0}>
        <div {...stylex.props(styles.empty)}>
          还没有创作容器。粘贴 AI 对话分享链接导入，创建你的第一个脚本。
          <div {...stylex.props(styles.emptyAction)}>
            <Button onClick={() => navigate("/")}>{t("studio.importFromLink")}</Button>
          </div>
        </div>
      </Show>

      <For each={items()}>
        {(item, i) => (
          <div>
            <Show when={i() > 0}>
              <hr {...stylex.props(styles.divider)} />
            </Show>
            <div {...stylex.props(styles.group)}>
              {/* 对话标题 - from AI 平台 */}
              <div
                {...stylex.props(styles.groupHeader)}
                onClick={() => navigate(`/polish/${item.id}`)}
              >
                <span {...stylex.props(styles.groupTitle)}>
                  {item.snapshotTitle ?? item.title ?? t("studio.unnamed")}
                </span>
                <Show when={item.aiName}>
                  <span {...stylex.props(styles.groupFrom)}>
                    - {t("studio.script.from")} {item.aiName}
                  </span>
                </Show>
              </div>
              {/* 脚本行：#N : 标题 - 已生成/未生成 */}
              <Show
                when={item.scripts.length > 0}
                fallback={<div {...stylex.props(styles.noScript)}>{t("studio.editor.noScript")}</div>}
              >
                <For each={item.scripts}>
                  {(script, j) => (
                    <div
                      {...stylex.props(styles.scriptRow)}
                      onClick={() => navigate(`/polish/${item.id}?script=${script.id}`)}
                    >
                      <span {...stylex.props(styles.scriptNum)}>#{j() + 1}</span>
                      <span {...stylex.props(styles.scriptTitle)}>
                        {script.title ?? script.topic ?? t("studio.editor.scriptNum", { num: j() + 1 })}
                      </span>
                      <span
                        {...stylex.props(
                          styles.scriptStatus,
                          script.status === "used" && styles.scriptUsed,
                        )}
                      >
                        {script.status === "used" ? t("studio.script.used") : t("studio.script.unused")}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
