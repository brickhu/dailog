import { createAsync } from "@solidjs/router";
import { createSignal, For, Show, Suspense } from "solid-js";
import { Title } from "@solidjs/meta";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { AuthGate } from "../../components/auth-gate";
import { PageSpinner } from "../../components/page-loading";

// 我的通知（/me/notifications）：投稿状态变化（收录/拒绝/上线）
// 数据组件在 AuthGate 内部（放行后才 fetch，避免登录判定前 401 缓存空数据）

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
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
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: dimensions.spacing6,
  },
  title: {
    fontSize: dimensions.fontSize2xl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  card: {
    display: "block",
    padding: dimensions.spacing4,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    marginBottom: dimensions.spacing3,
    textDecoration: "none",
    color: "inherit",
  },
  cardUnread: {
  },
  notifTitle: {
    fontWeight: dimensions.fontWeightMedium,
    marginBottom: dimensions.spacing1,
  },
  meta: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  empty: {
    color: colors.neutral,
    textAlign: "center",
    padding: dimensions.spacing12,
  },
});

function NotificationsList() {
  const { t } = useI18n();
  const [marked, setMarked] = createSignal(false);
  // tick 被 fetch 读取：markAllRead 后 +1 触发列表重新拉取（避免整页 reload 打断全局播放器）
  const [tick, setTick] = createSignal(0);
  const notifications = createAsync<NotificationRow[] | null>(async () => {
    if (typeof window === "undefined") return null;
    tick();
    const res = await fetch("/v1/me/notifications");
    if (!res.ok) return [];
    return (await res.json()) as NotificationRow[];
  });

  const markAllRead = async () => {
    await fetch("/v1/me/notifications/read-all", { method: "POST" }).catch(() => {});
    setMarked(true);
    // 刷新列表（已读状态），不整页 reload —— 保持播放器持续播放
    setTick((n) => n + 1);
  };

  const typeLabel = (type: string) => t(`notif.type.${type}` as never);

  return (
  <div {...stylex.props(layouts.page)}>
    <div {...stylex.props(layouts.containerSm)}>
      <div {...stylex.props(layouts.fullRow, styles.header)}>
        <div {...stylex.props(styles.title)}>{t("notif.title")}</div>
        <Button appear="ghost" onClick={markAllRead} disabled={marked()}>
          {t("notif.readAll")}
        </Button>
      </div>
      <Suspense fallback={<PageSpinner />}>
      <Show
        when={notifications()?.length}
        fallback={<div {...stylex.props(styles.empty)}>{t("notif.empty")}</div>}
      >
        <For each={notifications()}>
          {(n) => (
            <a
              href={n.link ?? "/me/submits"}
              {...stylex.props(styles.card, !n.readAt && styles.cardUnread)}
            >
              <div {...stylex.props(styles.notifTitle)}>{n.title}</div>
              <Show when={n.body}>
                <div {...stylex.props(styles.meta)}>{n.body}</div>
              </Show>
              <div {...stylex.props(styles.meta)}>
                {typeLabel(n.type)} · {n.createdAt ? new Date(n.createdAt).toLocaleString("zh-CN") : ""}
              </div>
            </a>
          )}
        </For>
      </Show>
      </Suspense>
    </div>
  </div>
  );
}

export default function NotificationsPage() {
  const { t } = useI18n();
  return (
      <AuthGate redirect="/me/notifications">
        <Title>{t("notif.title")} · dailog</Title>
        <NotificationsList />
      </AuthGate>
  );
}
