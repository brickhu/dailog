import { Show, createSignal, onMount } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { Button } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { LangSwitch } from "./lang-switch";
import { UserMenu, type NavUser } from "./user-menu";

const styles = stylex.create({
  header: {
    width: "100%",
    height: "56px",
    flexShrink: "0", // shellRoot 纵向 flex 容器：内容超高时不被压缩（保持吸顶高度）
    boxSizing: "border-box",
    padding: `0 ${dimensions.spacing8}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing4,
    position: "sticky", // 在 shellRoot 滚动容器内吸顶
    top: 0,
    zIndex: 40,
    backgroundColor: colors.background,
    "@media (max-width: 640px)": {
      padding: `0 ${dimensions.spacing4}`,
    },
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
    "@media (max-width: 767px)": {
      display: "none", // 移动端折叠进汉堡浮层
    },
  },
  hamburger: {
    display: "none",
    borderRadius: dimensions.radiusSm,
    background: "transparent",
    color: colors.foreground,
    width: "40px",
    height: "40px",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: "18px",
    "@media (max-width: 767px)": {
      display: "inline-flex", // 移动端：汉堡按钮
    },
  },
  drawer: {
    display: "none",
    "@media (max-width: 767px)": {
      display: "flex",
      flexDirection: "column",
      gap: dimensions.spacing1,
      padding: `${dimensions.spacing3} ${dimensions.spacing6} ${dimensions.spacing5}`,
      backgroundColor: colors.surface,
    },
  },
  drawerItem: {
    padding: `${dimensions.spacing3} 0`,
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    textDecoration: "none",
    display: "flex",
    alignItems: "center",
    gap: dimensions.spacing3,
    ":last-child": { borderBottom: "none" },
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
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = createSignal(false);
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
    // 聚合端点：一次请求替代 get-session + profile + 未读数三连
    const res = await fetch("/v1/me/overview");
    if (!res.ok) return;
    const data = (await res.json()) as {
      user?: { id?: string; name?: string | null; email?: string; image?: string | null } | null;
      nickname?: string | null;
      unreadCount?: number;
    } | null;
    const u = data?.user;
    if (!u?.email) return;
    // 主持人主页地址 = 账号昵称（@slug = user.name）
    setUser({ id: u.id ?? "", name: u.name ?? null, email: u.email, image: u.image ?? null, username: data?.nickname ?? null });
    if (typeof data?.unreadCount === "number") setUnread(data.unreadCount);
  });
  onMount(() => {
    window.addEventListener("focus", refreshUnread);
  });

  const signOut = async () => {
    await fetch("/v1/auth/sign-out", { method: "POST" }).catch(() => {});
    window.location.reload();
  };

  // 导航内容（桌面行内 + 移动浮层共用）
  const navContent = () => (
    <>
      <A href="/" {...stylex.props(styles.navLink)}>{t("nav.home")}</A>
      <A href="/discover" {...stylex.props(styles.navLink)}>{t("nav.discover")}</A>
      <A href="/hosts" {...stylex.props(styles.navLink)}>{t("nav.hosts")}</A>
      <A href="/guests" {...stylex.props(styles.navLink)}>{t("nav.guests")}</A>
      {/* 组件示例页：仅本地 dev 可见（生产构建 import.meta.env.DEV=false，整段不渲染） */}
      <Show when={import.meta.env.DEV}>
        <A href="/example" {...stylex.props(styles.navLink)}>{t("nav.example")}</A>
      </Show>
      {/* 订阅页（各平台入口 + feed 地址） */}
      <A href="/subscribe" {...stylex.props(styles.navLink)} title={t("nav.subscribe")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="18" r="2.5" />
          <path d="M4 10.5a9.5 9.5 0 0 1 9.5 9.5h-2.6A6.9 6.9 0 0 0 4 13.1V10.5Z" />
          <path d="M4 4a16 16 0 0 1 16 16h-2.7A13.3 13.3 0 0 0 4 6.7V4Z" />
        </svg>
      </A>
      <Button size="sm" onClick={() => navigate("/submit")}>
        {t("nav.submit")}
      </Button>
      <Show when={user()} fallback={<A href="/login" {...stylex.props(styles.login)}>{t("nav.login")}</A>}>
        {(u) => (
          <>
            <A href="/me/notifications" {...stylex.props(styles.bell)} aria-label="notifications">
              🔔
              <Show when={unread() > 0}>
                <span {...stylex.props(styles.badge)}>{unread() > 99 ? "99+" : unread()}</span>
              </Show>
            </A>
            <UserMenu user={u()} onSignOut={signOut} />
          </>
        )}
      </Show>
      <LangSwitch />
    </>
  );

  return (
    <>
    <header {...stylex.props(styles.header)}>
      <A href="/" {...stylex.props(styles.brand)}>
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
      </A>
      {/* 桌面：行内导航 */}
      <nav {...stylex.props(styles.nav)}>
        {navContent()}
      </nav>
      {/* 移动端：汉堡按钮（右侧导航折叠进浮层） */}
      <button
        {...stylex.props(styles.hamburger)}
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="menu"
        aria-expanded={menuOpen()}
      >
        ☰
      </button>
    </header>
    {/* 移动端浮层：汉堡展开的导航面板（跟随 header 文档流） */}
    <Show when={menuOpen()}>
      <div {...stylex.props(styles.drawer)} onClick={() => setMenuOpen(false)}>
        {navContent()}
      </div>
    </Show>
    </>
  );
}
