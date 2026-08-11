import { Show, createSignal, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { env } from "../lib/env";
import { useI18n } from "@dailogues/i18n";

const styles = stylex.create({
  header: {
    padding: `${dimensions.spacing4} ${dimensions.spacing8}`,
    borderBottom: `1px solid ${colors.ink}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontSize: "18px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.primary,
    textDecoration: "none",
  },
  login: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.foreground },
  },
  userBox: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
  },
  email: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
  },
  accountLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.foreground },
  },
  langSwitch: {
    backgroundColor: "transparent",
    border: `1px solid ${colors.ink}`,
    color: colors.neutral,
    borderRadius: dimensions.radiusSm,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    ":hover": { color: colors.foreground, borderColor: colors.neutral },
  },
  signOut: {
    backgroundColor: "transparent",
    border: `1px solid ${colors.ink}`,
    color: colors.neutral,
    borderRadius: dimensions.radiusSm,
    padding: `${dimensions.spacing1} ${dimensions.spacing2}`,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    ":hover": { color: colors.foreground, borderColor: colors.neutral },
  },
  bell: {
    position: "relative",
    fontSize: "16px",
    textDecoration: "none",
    color: colors.neutral,
  },
  badge: {
    position: "absolute",
    top: "-6px",
    right: "-10px",
    backgroundColor: colors.brandStrong,
    color: "#fff",
    fontSize: "10px",
    lineHeight: "14px",
    minWidth: "14px",
    textAlign: "center",
    borderRadius: "7px",
    padding: "0 3px",
  },
});

/** 消费端导航：brand + 语言切换 + 登录态。
 *  会话经 site 代理（/v1/auth/get-session）在 client 判定（cookie 同站自动携带）；
 *  SSR 首帧无 cookie 渲染"登录"，hydration 后更新为邮箱 + 登出。 */
export function SiteNav() {
  const { t, locale, setLocale } = useI18n();
  // 会话判定：仅 client 执行（SSR 无浏览器 cookie、相对 fetch 在 workerd 抛 Invalid URL）。
  // 不用 createAsync——其 SSR 序列化结果（null）会被 hydration 复用，不再重新请求；
  // onMount 保证挂载后必然重新 fetch，首帧渲染"登录"、挂载后更新为邮箱。
  const [user, setUser] = createSignal<{ email?: string } | null>(null);
  const [unread, setUnread] = createSignal(0);
  // 未读数：登录后拉取 + 窗口聚焦时刷新（通知页标记已读后返回可见）；
  // 未登录直接返回——否则 focus 触发会无条件请求 401（登录页控制台噪音）
  const refreshUnread = async () => {
    if (!user()) return;
    try {
      const res = await fetch("/v1/me/notifications/unread");
      if (res.ok) setUnread((await res.json()).count ?? 0);
    } catch { /* 静默 */ }
  };
  onMount(async () => {
    const res = await fetch("/v1/auth/get-session");
    if (!res.ok) return;
    // better-auth 未登录返回 JSON null（代理透传）——必须整体可选链，否则 onMount 抛错、导航永不更新
    const data = (await res.json()) as { user?: { email?: string } | null } | null;
    setUser(data?.user ?? null);
    if (data?.user) void refreshUnread();
  });
  onMount(() => {
    window.addEventListener("focus", refreshUnread);
  });

  const signOut = async () => {
    await fetch("/v1/auth/sign-out", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  return (
    <header {...stylex.props(styles.header)}>
      <a href="/" {...stylex.props(styles.brand)}>
        dailog
      </a>
      <div {...stylex.props(styles.userBox)}>
        <a href={env.adminBaseUrl} target="_blank" rel="noopener" {...stylex.props(styles.accountLink)}>
          {t("nav.admin")}
        </a>
        <button
          {...stylex.props(styles.langSwitch)}
          onClick={() => setLocale(locale() === "zh" ? "en" : "zh")}
        >
          {locale() === "zh" ? "EN" : "中文"}
        </button>
        <Show when={user()} fallback={<a href="/login" {...stylex.props(styles.login)}>{t("nav.login")}</a>}>
          {(u) => (
            <>
              <span {...stylex.props(styles.email)}>{u().email}</span>
              <a href="/me/notifications" {...stylex.props(styles.bell)} aria-label="notifications">
                🔔
                <Show when={unread() > 0}>
                  <span {...stylex.props(styles.badge)}>{unread() > 99 ? "99+" : unread()}</span>
                </Show>
              </a>
              <a href="/account" {...stylex.props(styles.accountLink)}>{t("nav.account")}</a>
              <button {...stylex.props(styles.signOut)} onClick={signOut}>
                {t("nav.logout")}
              </button>
            </>
          )}
        </Show>
      </div>
    </header>
  );
}
