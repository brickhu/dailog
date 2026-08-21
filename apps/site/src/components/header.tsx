import { Show, createMemo, createSignal, createUniqueId, onCleanup, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { A, useLocation, useNavigate } from "@solidjs/router";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, durations, easings, fontfamilies, layouts,global,typography } from "@dailogues/ui/theme.stylex";
import { Avatar, Button, Icon, Logo } from "@dailogues/ui";
import { MobileNav } from "./mobile-nav";
import { SideNav, SideNavItem, SideNavSection } from "./side-nav";
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
  // 移动端导航 drawer（复刻 Astryx MobileNav）样式已下沉到 @dailogues/ui 的
  // MobileNav 组件（packages/ui/src/components/mobile-nav.tsx），此处不再有浮层样式
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
  // SideNav 在 drawer 内铺满宽度（组件默认 260px 桌面侧栏宽度）
  sideNavFill: { width: "100%" },
  // 登出条目：危险色文本
  drawerDangerItem: { color: colors.danger },
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
// 桌面行内链接（LinkItem）与 drawer 内条目（DrawerLink）共用。
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

// drawer 内导航条目：SideNavItem 包装（经 as 传路由 A 实现 SPA 导航；激活态高亮 +
// 劫持当前页点击）。desktop 行内导航与 drawer 条目共用 useIsRouteActive，高亮语义一致
const DrawerLink = (props: {
  href: string;
  label: string;
  icon?: JSX.Element;
  endContent?: JSX.Element;
  /** 精确匹配（end） */
  end?: boolean;
  /** 条目尺寸（子条目用 md，一级用 lg）@default "lg" */
  size?: "sm" | "md" | "lg";
}) => {
  const isActive = useIsRouteActive(props.href, props.end);
  return (
    <SideNavItem
      as={A}
      href={props.href}
      label={props.label}
      icon={props.icon}
      endContent={props.endContent}
      size={props.size ?? "lg"}
      isSelected={isActive()}
      onClick={(e) => {
        if (isActive()) e.preventDefault();
      }}
    />
  );
};

// drawer 账号区（未登录）：登录入口。
// 与 DrawerAccountSection 一起经 <Dynamic component={...}> 按登录态切换（替代
// Show 的惰性 children——hydration 后 children 函数首次求值嵌套 JSX 时存在模板
// 提升问题；Dynamic 按组件引用渲染，无此问题）
const DrawerLoginItem = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <SideNavItem
      label={t("nav.login")}
      icon={<Icon icon="iconoir:user" width={18} height={18} />}
      size="lg"
      onClick={() => navigate("/login")}
    />
  );
};

// drawer 账号区（登录后）：投稿 / 通知 / 账号分组（二级纵向菜单，可折叠嵌套子项）。
// user 类型允许 null（Dynamic 的 component 分支运行时才保证非空）
const DrawerAccountSection = (props: { user: NavUser | null; unread: number }) => {
  const { t } = useI18n();
  return (
    <>
      <SideNavItem
        label={t("nav.submit")}
        icon={<Icon icon="iconoir:upload" width={18} height={18} />}
        size="lg"
        onClick={openImportDialog}
      />
      <DrawerLink
        href="/me/notifications"
        label={t("me.notifications")}
        icon={<Icon icon="iconoir:bell" width={18} height={18} />}
        endContent={
          props.unread > 0 ? (
            <span {...stylex.props(styles.drawerBadge)}>{props.unread > 99 ? "99+" : props.unread}</span>
          ) : undefined
        }
      />
      {/* 二级：账号分组——头像为图标，点击展开/收起子条目（折叠切换不收起 drawer） */}
      <SideNavItem
        label={props.user!.name || t("common.unnamed")}
        icon={<Avatar image={props.user!.image} name={props.user!.name} email={props.user!.email} size={20} />}
        size="lg"
      >
        <DrawerLink href="/me" label={t("nav.profile")} size="md" />
        <DrawerLink href="/me/episodes" label={t("me.episodes")} size="md" />
        <DrawerLink href="/me/submits" label={t("nav.submissions")} size="md" />
        <DrawerLink href="/me/favorites" label={t("nav.favorites")} size="md" />
        <DrawerLink href="/account" label={t("nav.settings")} size="md" />
        <SideNavItem label={t("nav.logout")} size="md" xstyle={styles.drawerDangerItem} onClick={() => confirmSignOut()} />
      </SideNavItem>
    </>
  );
};

/** 消费端导航：brand + home/discover + [投稿] + 通知 + 头像菜单 + 语言切换。
 *  会话经 site 代理（/v1/auth/get-session）在 client 判定（cookie 同站自动携带）；
 *  SSR 首帧无 cookie 渲染"登录"，hydration 后更新为头像菜单。 */
export function SiteNav() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = createSignal(false);
  // drawer dialog 的 id：汉堡按钮 aria-controls 与 MobileNav 的 dialog id 关联
  //（MobileNav 把 id 透传给原生 <dialog>；无 AppShell 上下文，受控使用 isOpen/onOpenChange）
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
      {/* 移动端：汉堡按钮（右侧导航折叠进 drawer；aria-controls 指向 MobileNav dialog） */}
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
    {/* 移动端导航 drawer（复刻 Astryx MobileNav + SideNav 家族）：汉堡触发的滑出抽屉，
        内容为两级纵向菜单——SideNavSection 一级分组 + SideNavItem 二级条目（账号分组为
        可折叠嵌套子项）。关闭策略：遮罩点击 / Escape / 头部关闭按钮 → onOpenChange(false)；
        点 drawer 内导航链接（a）→ 收起；二级菜单按钮（语言）与折叠切换（账号分组）
        （data-menu-trigger / data-sidenav-toggle）不收起 */}
    <MobileNav
      id={navDialogId}
      isOpen={menuOpen()}
      onOpenChange={setMenuOpen}
    >
      <div
        onClick={(e) => {
          const target = e.target as HTMLElement;
          // 语言切换（菜单要弹出）与账号分组折叠切换不收起；其余（链接/按钮/空白）收起
          if (target.closest("[data-menu-trigger], [data-sidenav-toggle]")) return;
          setMenuOpen(false);
        }}
      >
        <SideNav xstyle={styles.sideNavFill}>
          {/* 一级：浏览 */}
          <SideNavSection title={t("nav.browse")}>
            <DrawerLink href="/" end label={t("nav.home")} icon={<Icon icon="iconoir:home" width={18} height={18} />} />
            <DrawerLink href="/discover" label={t("nav.discover")} icon={<Icon icon="iconoir:compass" width={18} height={18} />} />
            <DrawerLink href="/hosts" label={t("nav.hosts")} icon={<Icon icon="iconoir:microphone" width={18} height={18} />} />
            <DrawerLink href="/guests" label={t("nav.guests")} icon={<Icon icon="iconoir:user" width={18} height={18} />} />
            {/* 组件示例页：仅本地 dev 可见（条件渲染，不走 Show 的惰性 children） */}
            {import.meta.env.DEV ? (
              <DrawerLink href="/example" label={t("nav.example")} icon={<Icon icon="iconoir:code" width={18} height={18} />} />
            ) : null}
          </SideNavSection>
          {/* 一级：账号 */}
          <SideNavSection title={t("nav.account")}>
            <SideNavItem
              label={t("search.title")}
              icon={<Icon icon="iconoir:search" width={18} height={18} />}
              size="lg"
              onClick={openSearchDialog}
            />
            {/* 登录态内容经 Dynamic 按登录态切换组件（替代 Show 惰性 children——
               避免 hydration 后 children 函数首次求值嵌套 JSX 的模板问题） */}
            <Dynamic
              component={user() ? DrawerAccountSection : DrawerLoginItem}
              user={user()}
              unread={unread()}
            />
          </SideNavSection>
          {/* 底部：语言切换（二级菜单触发器，点击不收起 drawer） */}
          <div {...stylex.props(styles.drawerLangRow)}>{menuTriggerWrap(<LangSwitch />)}</div>
        </SideNav>
      </div>
    </MobileNav>
    </>
  );
}
