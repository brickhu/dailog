import { Show, createMemo, createSignal, createUniqueId, onCleanup, onMount, type JSX } from "solid-js";
import { A, useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, durations, easings, fontfamilies, layouts,global,typography } from "@dailogues/ui/theme.stylex";
import { Button, Icon, Logo, Drawer } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";
import { LangSwitch } from "./lang-switch";
import { UserMenu, type NavUser } from "./user-menu";
import { confirmSignOut } from "../lib/auth-guard";
import { openImportDialog } from "./import-dialog";
import { openSearchDialog } from "./search-dialog";

// 断点标签（与 theme.stylex.ts 的 DESKTOP/TABLET 同值——stylex babel 插件不支持
// 跨文件常量解析，本地定义保持一致；改断点请同步 theme.stylex.ts）
const DESKTOP = "@media (width >= 1024px)";
const TABLET = "@media (640px <= width < 1024px)";

const styles = stylex.create({
  header: {
    // iOS 沉浸：高度 = 常规高度 + safe-area（状态栏/刘海），内容下移避开；
    // 非 iOS 环境 env() = 0 无影响。背景色随 headerScrolled 覆盖状态栏区域
    height: `calc(${dimensions.size2xl} + env(safe-area-inset-top))`,
    paddingTop: "env(safe-area-inset-top)",
    flexShrink: "0", // shellRoot 纵向 flex 容器：内容超高时不被压缩（保持吸顶高度）
    boxSizing: "border-box",
    paddingLeft: dimensions.spacing4,
    paddingRight: dimensions.spacing4,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing4,
    position: "sticky", // 在 shellRoot 滚动容器内吸顶
    top: 0,
    zIndex: 40,
    // 默认透明，滚动后（scrolled）过渡到半透明毛玻璃背景 + 底部 border——页面内容压过导航时保证可读性
    backgroundImage: `linear-gradient(to bottom, transparent 0%, transparent 100%)`,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    transitionProperty: "backgroundImage, border-color, backdrop-filter, -webkit-backdrop-filter",
    transitionDuration: durations.durationMediumMin,
    transitionTimingFunction: easings.easeInOut,
    [TABLET]: {
      padding: `0 ${dimensions.spacing8}`,
    },
    [DESKTOP]: {
      padding: `0 ${dimensions.spacing8}`,
    },
  },
  headerScrolled: {
    // 背景 85% 半透明 + 毛玻璃（与 player-bar 同款 blur）；color-mix 让 token 的
    // 双主题（default/DARK）自动适配，不硬编码 rgba
    backgroundImage: `linear-gradient(to bottom,  ${colors.background} 20%, color-mix(in srgb, ${colors.background} 80%, transparent) 100%)`,
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    // color-mix 百分比必须跟在颜色后（`颜色 10%`）；currentColor = 页面前景色，
    // 主题自动适配，且不依赖模板字符串里的跨文件 var（stylex 编译期不可靠）
    borderBottomColor: "color-mix(in srgb, currentColor 10%, transparent)",
  },
  brand: {
    textDecoration: "none",
    display: "inline-flex",
    // 必须显式继承：A 标签 UA 默认 color 是链接蓝（-webkit-link），会阻断 shellRoot
    // foreground 的继承——logo 的 fill 未注入 CSS 变量时回落到 currentColor，取到的就是蓝色而非前景色
    color: colors.primary,
    "--fill-pattern" : colors.brand,
    ":hover" : {
      "--fill-pattern" : colors.primary,
    }
  },
  nav: {
    display: "none", // 移动优先：<640 折叠进汉堡浮层
    alignItems: "center",
    gap: dimensions.spacing4,
    [TABLET]: {
      display: "flex",
    },
    [DESKTOP]: {
      display: "flex",
    },
  },
  hamburger: {
    display: "inline-flex", // 移动优先：<640 显示汉堡按钮
    borderRadius: dimensions.radiusSm,
    background: "transparent",
    color: colors.foreground,
    width: "40px",
    height: "40px",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: "18px",
    [TABLET]: {
      display: "none",
    },
    [DESKTOP]: {
      display: "none",
    },
  },
  // 移动端导航 drawer 样式已下沉到 @dailogues/ui 的通用 Drawer 组件
  //（packages/ui/src/components/drawer.tsx，复刻 Astryx MobileNav 的抽屉机制），此处不再有浮层样式
  navLink: {
    textDecoration: "none",
  },
  // 当前路由高亮：品牌绿 + 加粗；hover 保持高亮（覆盖 global.linkText 的 hover 变色），
  // cursor 变 default 提示"当前页不可点"（点击已被劫持）
  navLinkActive: {
    color: colors.brandStrong,
    fontWeight: dimensions.fontWeightMedium,
    cursor: "default",
    ":hover": { color: colors.brandStrong },
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
  // drawer 内通知条目的未读角标（静态定位，区别于头部铃铛的绝对定位 badge）
  drawerBadge: {
    backgroundColor: colors.brandStrong,
    color: "#fff",
    fontSize: "10px",
    lineHeight: "14px",
    minWidth: "14px",
    textAlign: "center",
    borderRadius: "7px",
    padding: "0 3px",
  },
  // drawer 内容列表（简单纵向导航，无 SideNav 分组）
  drawerList: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing1,
    padding: dimensions.spacing2,
  },
  drawerDivider: {
    height: "1px",
    backgroundColor: "color-mix(in srgb, currentColor 10%, transparent)",
    marginBlock: dimensions.spacing1,
  },
  drawerLink: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: dimensions.spacing2,
    textDecoration: "none",
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightNormal,
    padding: `${dimensions.spacing3} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusMd,
    ":hover": {
      backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    },
  },
  // 当前路由高亮：品牌绿 + 加粗；hover 保持高亮（覆盖 linkText hover 变色）
  drawerLinkActive: {
    color: colors.brandStrong,
    fontWeight: dimensions.fontWeightMedium,
    cursor: "default",
    ":hover": { color: colors.brandStrong },
  },
  drawerLinkLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  drawerLinkEnd: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
  },
  // drawer 内动作按钮（搜索/登录/投稿/登出）
  drawerAction: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    background: "none",
    borderStyle: "none",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    color: colors.foreground,
    fontSize: dimensions.fontSizeMd,
    fontWeight: dimensions.fontWeightNormal,
    padding: `${dimensions.spacing3} ${dimensions.spacing2}`,
    borderRadius: dimensions.radiusMd,
    ":hover": {
      backgroundColor: "color-mix(in srgb, currentColor 8%, transparent)",
    },
  },
  // 登出动作：危险色文本
  drawerActionDanger: { color: colors.danger },
  // drawer 底部语言切换行：右对齐
  drawerLangRow: {
    display: "flex",
    justifyContent: "flex-end",
    paddingInline: dimensions.spacing1,
    paddingBlock: dimensions.spacing1,
  },
  logo: {
    height: dimensions.sizeMd,
    
  },
  // 搜索入口：移动端图标按钮（<640，汉堡旁）……
  searchIconBtn: {
    display: "inline-flex",
    width: "40px",
    height: "40px",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: dimensions.radiusSm,
    background: "transparent",
    color: colors.foreground,
    cursor: "pointer",
    fontSize: "18px",
  },
  // ……桌面端胶囊（点击打开搜索；⌘K 快捷键提示）
  searchPill: {
    display: "none",
    alignItems: "center",
    gap: dimensions.spacing2,
    height: "36px",
    paddingInline: dimensions.spacing3,
    borderRadius: dimensions.radiusFull,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "color-mix(in srgb, currentColor 18%, transparent)",
    backgroundColor: `color-mix(in srgb, ${colors.surface} 55%, transparent)`,
    color: colors.neutral,
    fontSize: dimensions.fontSizeSm,
    cursor: "pointer",
    transitionProperty: "color, border-color, background-color",
    transitionDuration: durations.durationFast,
    ":hover": {
      color: colors.foreground,
      borderColor: "color-mix(in srgb, currentColor 35%, transparent)",
    },
    [TABLET]: { display: "inline-flex" },
    [DESKTOP]: { display: "inline-flex" },
  },
  searchKbd: {
    fontFamily: fontfamilies.code,
    fontSize: "11px",
    lineHeight: 1,
    padding: "3px 6px",
    borderRadius: dimensions.radiusSm,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "color-mix(in srgb, currentColor 20%, transparent)",
    backgroundColor: `color-mix(in srgb, ${colors.surface} 80%, transparent)`,
    color: "inherit",
  },
});

// 路由激活判定（与 @solidjs/router 的 <A> 同语义）：忽略大小写/尾部斜杠；end=true 仅
// 精确匹配（首页 "/" 必须 end——否则前缀匹配下任意路径都以 "/" 开头而常亮）。
// 桌面行内链接（LinkItem）与 drawer 内链接（DrawerNavLink）共用。
function useIsRouteActive(href: string, end?: boolean) {
  const location = useLocation();
  return createMemo(() => {
    const path = href.split(/[?#]/, 1)[0].toLowerCase().replace(/\/$/, "");
    const loc = decodeURI(location.pathname.toLowerCase().replace(/\/$/, ""));
    return end ? path === loc : loc.startsWith(path + "/") || loc === path;
  });
}

// 路由感知导航链接：命中当前路由时高亮（navLinkActive）并劫持点击（不可跳转）。
// 劫持原理：router 在 document 上的 click 监听先检查 evt.defaultPrevented，命中即放弃
// 导航；Solid 的委托事件处理器先于该监听执行（router 内部先调 delegateEvents），
// 因此这里 preventDefault 即可可靠拦下（含键盘 Enter 触发的 click）。
const LinkItem = (props: {
  href: string;
  children: JSX.Element;
  title?: string;
  /** 精确匹配（end）：仅当前路径完全等于 href 时高亮/劫持 */
  end?: boolean;
}) => {
  const isActive = useIsRouteActive(props.href, props.end);
  return (
    <A
      href={props.href}
      end={props.end}
      onClick={(e) => {
        // 当前路由的链接：劫持点击——preventDefault 后 router 监听直接 return，不导航
        if (isActive()) e.preventDefault();
      }}
      {...stylex.props(global.linkText, typography.bodyMd, styles.navLink, isActive() && styles.navLinkActive)}
      title={props.title}
    >
      {props.children}
    </A>
  );
};

// drawer 内导航链接：A（SPA 导航）+ 当前路由高亮 + 劫持当前页点击，块状样式。
// desktop 行内链接与 drawer 链接共用 useIsRouteActive，高亮语义一致
const DrawerNavLink = (props: {
  href: string;
  label: string;
  /** 精确匹配（end） */
  end?: boolean;
  /** 尾部内容（未读角标等） */
  endContent?: JSX.Element;
}) => {
  const isActive = useIsRouteActive(props.href, props.end);
  return (
    <A
      href={props.href}
      end={props.end}
      onClick={(e) => {
        if (isActive()) e.preventDefault();
      }}
      {...stylex.props(styles.drawerLink, isActive() && styles.drawerLinkActive)}
    >
      <span {...stylex.props(styles.drawerLinkLabel)}>{props.label}</span>
      {props.endContent != null && (
        <span {...stylex.props(styles.drawerLinkEnd)}>{props.endContent}</span>
      )}
    </A>
  );
};

export function Header() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = createSignal(false);
  // drawer dialog 的 id：汉堡按钮 aria-controls 与 Drawer 的 dialog id 关联
  //（Drawer 把 id 透传给原生 <dialog>；无 AppShell 上下文，受控使用 isOpen/onOpenChange）
  const navDialogId = createUniqueId();
  // 滚动状态：滚动容器是父级 shellRoot（header 吸顶在其内），scrollTop > 0 时背景
  // 由透明过渡到实色。onMount 先同步一次初值——首帧样式变化发生在浏览器绘制前，
  // 不会触发过渡动画（避免深链接/滚动恢复时闪一下透明）
  const [scrolled, setScrolled] = createSignal(false);
  let headerRef: HTMLElement | undefined;
  onMount(() => {
    const scroller = headerRef?.parentElement;
    if (!scroller) return;
    const onScroll = () => setScrolled(scroller.scrollTop > 0);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => scroller.removeEventListener("scroll", onScroll));
  });
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

  // 退出登录：走全局确认守卫（确认后才真正登出；登出逻辑在 auth-guard）



  // 导航内容（桌面行内 + 移动浮层共用）
  const navContent = () => (
    <>
      <LinkItem href="/" end title={t("nav.home")}>{t("nav.home")}</LinkItem>
      <LinkItem href="/discover" title={t("nav.discover")}>{t("nav.discover")}</LinkItem>
      <LinkItem href="/hosts" title={t("nav.hosts")}>{t("nav.hosts")}</LinkItem>
      <LinkItem href="/guests" title={t("nav.guests")}>{t("nav.guests")}</LinkItem>
      {/* 组件示例页：仅本地 dev 可见（生产构建 import.meta.env.DEV=false，整段不渲染） */}
      <Show when={import.meta.env.DEV}>
        <LinkItem href="/example" title={t("nav.example")}>{t("nav.example")}</LinkItem>
      </Show>
      {/* 订阅页（各平台入口 + feed 地址） */}
      {/* <LinkItem href="/subscribe"  title={t("nav.subscribe")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="6" cy="18" r="2.5" />
          <path d="M4 10.5a9.5 9.5 0 0 1 9.5 9.5h-2.6A6.9 6.9 0 0 0 4 13.1V10.5Z" />
          <path d="M4 4a16 16 0 0 1 16 16h-2.7A13.3 13.3 0 0 0 4 6.7V4Z" />
        </svg>
      </LinkItem> */}

      {/* <button
        type="button"
        onClick={openSearchDialog}
        {...stylex.props(styles.searchPill)}
      >
        <Icon icon="iconoir:search" width={16} />
        <span>{t("search.title")}</span>
        <kbd {...stylex.props(styles.searchKbd)}>⌘K</kbd>
      </button> */}
      <button
        type="button"
        onClick={openSearchDialog}
        {...stylex.props(styles.searchIconBtn)}
        aria-label={t("search.title")}
      >
        <Icon icon="iconoir:search" />
      </button>
      {/* 投稿入口仅登录后显示（user 由 onMount 判定；首帧未确认前不显示） */}
      {/* <Show when={user()}>
        <Button size="sm" onClick={openImportDialog}>
          {t("nav.submit")}
        </Button>
      </Show> */}
      <Show when={user()} fallback={<Button size="sm" round="full" onClick={() => navigate("/login")}>{t("nav.login")}</Button>}>
        {(u) => (
          <>
            <Button size="sm" round="full" onClick={openImportDialog}>
              {t("nav.submit")}
            </Button>
            <A href="/me/notifications" {...stylex.props(styles.bell)} aria-label="notifications">
              🔔
              <Show when={unread() > 0}>
                <span {...stylex.props(styles.badge)}>{unread() > 99 ? "99+" : unread()}</span>
              </Show>
            </A>
            {menuTriggerWrap(<UserMenu user={u()} onSignOut={() => confirmSignOut()} />)}
          </>
        )}
      </Show>
      {menuTriggerWrap(<LangSwitch />)}
    </>
  );

  // 二级菜单触发器标记（语言/头像）：点击不收起浮层（二级菜单要弹出）；
  // 其余菜单项（链接/按钮）点击一律收起
  const menuTriggerWrap = (node: JSX.Element) => (
    <div data-menu-trigger={true}>{node}</div>
  );

  return (
    <>
    <header ref={headerRef} {...stylex.props(layouts.containerFull, styles.header, scrolled() && styles.headerScrolled)}>
      <A href="/" {...stylex.props(styles.brand)}>
        <Logo {...stylex.props(styles.logo)} />
      </A>

      {/* 桌面：行内导航 */}
      <nav {...stylex.props(styles.nav)}>
        {navContent()}
      </nav>
      {/* 移动端：汉堡按钮（右侧导航折叠进 drawer；aria-controls 指向 Drawer dialog） */}
      <button
        {...stylex.props(styles.hamburger)}
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={t("mobileNav.openNavigation")}
        aria-expanded={menuOpen()}
        aria-controls={navDialogId}
      >
        <Icon icon="iconoir:menu" width={24}/>
      </button>
    </header>
    {/* 站点移动导航抽屉：基于通用 Drawer（@dailogues/ui），配置站点导航标题/宽度。
        内容为简单纵向导航列表（导航链接 + 搜索/登录/投稿/通知/账号入口）。
        关闭策略：遮罩点击 / Escape / 头部关闭按钮 → onOpenChange(false)；
        点 drawer 内导航链接（a）→ 收起；语言切换（data-menu-trigger）不收起 */}
    <Drawer
      id={navDialogId}
      isOpen={menuOpen()}
      onOpenChange={setMenuOpen}
      header={t("mobileNav.navigation")}
      width={320}
    >
      <div
        onClick={(e) => {
          const target = e.target as HTMLElement;
          // 语言切换（菜单要弹出）不收起；其余（链接/按钮/空白）收起
          if (target.closest("[data-menu-trigger]")) return;
          setMenuOpen(false);
        }}
      >
        <div {...stylex.props(styles.drawerList)}>
          <DrawerNavLink href="/" end label={t("nav.home")} />
          <DrawerNavLink href="/discover" label={t("nav.discover")} />
          <DrawerNavLink href="/hosts" label={t("nav.hosts")} />
          <DrawerNavLink href="/guests" label={t("nav.guests")} />
          {/* 组件示例页：仅本地 dev 可见 */}
          {import.meta.env.DEV ? (
            <DrawerNavLink href="/example" label={t("nav.example")} />
          ) : null}
          <div {...stylex.props(styles.drawerDivider)} />
          <button
            type="button"
            {...stylex.props(styles.drawerAction)}
            onClick={openSearchDialog}
          >
            {t("search.title")}
          </button>
          <Show
            when={user()}
            fallback={
              <button
                type="button"
                {...stylex.props(styles.drawerAction)}
                onClick={() => navigate("/login")}
              >
                {t("nav.login")}
              </button>
            }
          >
            {(
              <>
                <button
                  type="button"
                  {...stylex.props(styles.drawerAction)}
                  onClick={openImportDialog}
                >
                  {t("nav.submit")}
                </button>
                <DrawerNavLink
                  href="/me/notifications"
                  label={t("me.notifications")}
                  endContent={
                    unread() > 0 ? (
                      <span {...stylex.props(styles.drawerBadge)}>{unread() > 99 ? "99+" : unread()}</span>
                    ) : undefined
                  }
                />
                <div {...stylex.props(styles.drawerDivider)} />
                <DrawerNavLink href="/me" label={t("nav.profile")} />
                <DrawerNavLink href="/me/episodes" label={t("me.episodes")} />
                <DrawerNavLink href="/me/submits" label={t("nav.submissions")} />
                <DrawerNavLink href="/me/favorites" label={t("nav.favorites")} />
                <DrawerNavLink href="/account" label={t("nav.settings")} />
                <button
                  type="button"
                  {...stylex.props(styles.drawerAction, styles.drawerActionDanger)}
                  onClick={() => confirmSignOut()}
                >
                  {t("nav.logout")}
                </button>
              </>
            )}
          </Show>
        </div>
        {/* 底部：语言切换（二级菜单触发器，点击不收起 drawer） */}
        <div {...stylex.props(styles.drawerLangRow)}>{menuTriggerWrap(<LangSwitch />)}</div>
      </div>
    </Drawer>
    </>
  );
}
