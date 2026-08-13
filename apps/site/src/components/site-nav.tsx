import { Show, createSignal, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { LangSwitch } from "./lang-switch";
import { UserMenu, type NavUser } from "./user-menu";

const styles = stylex.create({
  header: {
    padding: `${dimensions.spacing4} ${dimensions.spacing8}`,
    borderBottom: `1px solid ${colors.ink}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing4,
  },
  brand: {
    fontSize: "18px",
    fontWeight: dimensions.fontWeightBold,
    color: colors.primary,
    textDecoration: "none",
    display: "inline-flex",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing4,
  },
  navLink: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.foreground },
  },
  login: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    textDecoration: "none",
    ":hover": { color: colors.foreground },
  },
  bell: {
    position: "relative",
    fontSize: "16px",
    textDecoration: "none",
    color: colors.neutral,
    display: "inline-flex",
    ":hover": { color: colors.foreground },
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
  logo: {
    height: "32px",
  },
});

/** 消费端导航：brand + home/discover + [投稿] + 通知 + 头像菜单 + 语言切换。
 *  会话经 site 代理（/v1/auth/get-session）在 client 判定（cookie 同站自动携带）；
 *  SSR 首帧无 cookie 渲染"登录"，hydration 后更新为头像菜单。 */
export function SiteNav() {
  const { t } = useI18n();
  // 会话判定：仅 client 执行（SSR 无浏览器 cookie、相对 fetch 在 workerd 抛 Invalid URL）。
  // 不用 createAsync——其 SSR 序列化结果（null）会被 hydration 复用，不再重新请求；
  // onMount 保证挂载后必然重新 fetch，首帧渲染"登录"、挂载后更新为头像菜单。
  const [user, setUser] = createSignal<NavUser | null>(null);
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
    const data = (await res.json()) as { user?: { id?: string; name?: string | null; email?: string; image?: string | null } | null } | null;
    const u = data?.user;
    if (!u?.email) return;
    // 频道地址（profiles.username）不在 better-auth session 里——补一次 /v1/me/profile
    let username: string | null = null;
    try {
      const p = await fetch("/v1/me/profile");
      if (p.ok) username = ((await p.json()) as { username?: string | null }).username ?? null;
    } catch { /* 静默 */ }
    setUser({ id: u.id ?? "", name: u.name ?? null, email: u.email, image: u.image ?? null, username });
    void refreshUnread();
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
        <svg {...stylex.props(styles.logo)} viewBox="0 0 288 104" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M52 32H28V64H52V72H20V24H52V32Z" fill="currentColor"/>
          <path d="M60 64H52V32H60V64Z" fill="currentColor"/>
          <path d="M212 72H188V64H212V72Z" fill="currentColor"/>
          <path d="M188 64H180V32H188V64Z" fill="currentColor"/>
          <path d="M220 64H212V32H220V64Z" fill="currentColor"/>
          <path d="M212 32H188V24H212V32Z" fill="currentColor"/>
          <path d="M260 72H236V64H260V72Z" fill="currentColor"/>
          <path d="M236 64H228V32H236V64Z" fill="currentColor"/>
          <path d="M268 48V64H260V56H252V48H268Z" fill="currentColor"/>
          <path d="M268 40H260V32H268V40Z" fill="currentColor"/>
          <path d="M260 32H236V24H260V32Z" fill="currentColor"/>
          <path d="M128 72H120V24H128V72Z" fill="#01C82C"/>
          <path d="M148 64H172V72H140V24H148V64Z" fill="currentColor"/>
          <path d="M76 48H100V32H108V72H100V56H76V72H68V32H76V48Z" fill="#01C82C"/>
          <path d="M100 32H76V24H100V32Z" fill="#01C82C"/>
          <path d="M116 96H108L100 88H68V80H104L112 88L120 80H128V88H124L116 96Z" fill="#01C82C"/>
          </svg>
      </a>
      <nav {...stylex.props(styles.nav)}>
        <a href="/" {...stylex.props(styles.navLink)}>{t("nav.home")}</a>
        <a href="/discover" {...stylex.props(styles.navLink)}>{t("nav.discover")}</a>
        <Button size="sm" onClick={() => { window.location.href = "/submit"; }}>
          {t("nav.submit")}
        </Button>
        <Show when={user()} fallback={<a href="/login" {...stylex.props(styles.login)}>{t("nav.login")}</a>}>
          {(u) => (
            <>
              <a href="/me/notifications" {...stylex.props(styles.bell)} aria-label="notifications">
                🔔
                <Show when={unread() > 0}>
                  <span {...stylex.props(styles.badge)}>{unread() > 99 ? "99+" : unread()}</span>
                </Show>
              </a>
              <UserMenu user={u()} onSignOut={signOut} />
            </>
          )}
        </Show>
        <LangSwitch />
      </nav>
    </header>
  );
}
