import { createAsync } from "@solidjs/router";
import { For, Show } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { useI18n } from "@dailogues/i18n";
import { SiteNav } from "../../components/site-nav";
import { AuthGate } from "../../components/auth-gate";

// 我的投稿（PRD §5 /me/submits）：投稿状态列表（审核中/已收录/投稿失败 + 最新节目状态）
// 会话判定与 me.tsx 同模式（client 判定，未登录跳统一登录）

interface SubmissionRow {
  id: string;
  title: string | null;
  status: string;
  snapshotTitle: string | null;
  platform: string | null;
  episodeStatus: string | null;
  rejectedReason: string | null;
  createdAt: string;
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
  subTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  badge: {
    display: "inline-block",
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusSm,
    backgroundColor: colors.surfaceStrong,
    fontSize: dimensions.fontSizeSm,
    marginLeft: dimensions.spacing2,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing3,
    alignItems: "center",
  },
  submitLink: {
    color: colors.brandStrong,
    textDecoration: "underline",
  },
  reason: {
    color: colors.danger,
    fontSize: dimensions.fontSizeSm,
    marginTop: dimensions.spacing1,
  },
});

// 数据列表组件：仅在 AuthGate 放行后渲染（挂载时才 fetch）——
// createAsync 若在页面组件顶层执行，会在 AuthGate 判定登录前发起请求（401 → [] 被缓存，放行后不再重取）
function SubmissionsList() {
  const { t } = useI18n();
  const submissions = createAsync<SubmissionRow[] | null>(async () => {
    // SSR 首帧短路：相对路径在服务端无法解析（Node fetch 需绝对 URL）
    if (typeof window === "undefined") return null;
    const res = await fetch("/v1/me/submissions");
    if (!res.ok) return [];
    return (await res.json()) as SubmissionRow[];
  });

  // 投稿状态 → i18n 键（状态值来自后端，动态拼接需显式映射）
  const STATUS_KEYS: Record<string, Parameters<typeof t>[0]> = {
    submitted: "status.submitted",
    accepted: "status.accepted",
    rejected: "status.rejected",
    published: "status.published",
    generating: "status.generating",
    failed: "status.failed",
  };
  const statusLabel = (status: string | null) => {
    if (!status) return "";
    const key = STATUS_KEYS[status];
    return key ? t(key) : status;
  };

  return (
    <div {...stylex.props(styles.content)}>
      <div {...stylex.props(styles.title)}>{t("meSubmits.title")}</div>
      <Show
        when={submissions()?.length}
        fallback={
          <div {...stylex.props(styles.empty)}>
            <span>{t("meSubmits.empty")}</span>
            <a href="/submit" {...stylex.props(styles.submitLink)}>{t("meSubmits.submit")} →</a>
          </div>
        }
      >
        <For each={submissions()}>
          {(sub) => (
            <div {...stylex.props(styles.card)}>
              <div {...stylex.props(styles.subTitle)}>
                {sub.title || sub.snapshotTitle || t("common.unnamed")}
                <span {...stylex.props(styles.badge)}>{statusLabel(sub.status)}</span>
              </div>
              <div {...stylex.props(styles.meta)}>
                {sub.createdAt ? new Date(sub.createdAt).toLocaleDateString("zh-CN") : ""}
                {sub.platform ? ` · ${sub.platform}` : ""}
                {sub.episodeStatus ? ` · ${statusLabel(sub.episodeStatus)}` : ""}
              </div>
              <Show when={sub.status === "rejected" && sub.rejectedReason}>
                <div {...stylex.props(styles.reason)}>{t("meSubmits.rejectReason")}：{sub.rejectedReason}</div>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

export default function MeSubmitsPage() {
  const { t } = useI18n();
  return (
    <div {...stylex.props(styles.page)}>
      <Title>{t("meSubmits.title")} · dailog</Title>
      <SiteNav />
      <AuthGate redirect="/me/submits">
        <SubmissionsList />
      </AuthGate>
    </div>
  );
}

