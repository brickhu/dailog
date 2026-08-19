import { A } from "@solidjs/router";
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions, shadows } from "@dailogues/ui/theme.stylex";
import { Avatar } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

// 用户菜单：圆形头像（有图用图，无图 hash-avatar）+ 下拉菜单
// profile → /me（个人中心）、submissions → /me/submits、
// favorites → /me（收藏）、settings → /account、logout → 登出。点击外部自动收起。

export interface NavUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  /** 主持人主页地址（@slug = user.name；公开主页为 /@<username>，v2 预留入口用） */
  username: string | null;
}

const styles = stylex.create({
  wrap: {
    position: "relative",
  },
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    border: "none",
    background: "none",
    borderRadius: "50%",
    cursor: "pointer",
  },
  menu: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 6px)",
    minWidth: "180px",
    padding: dimensions.spacing1,
    borderRadius: dimensions.radiusMd,
    backgroundColor: colors.surface,
    boxShadow: shadows.shadowMed,
    display: "flex",
    flexDirection: "column",
    zIndex: 20,
  },
  identity: {
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    marginBottom: dimensions.spacing1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  name: {
    fontSize: dimensions.fontSizeSm,
    fontWeight: dimensions.fontWeightMedium,
    color: colors.foreground,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  email: {
    fontSize: dimensions.fontSizeSm,
    color: colors.neutral,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  item: {
    display: "block",
    textDecoration: "none",
    textAlign: "left",
    padding: `${dimensions.spacing2} ${dimensions.spacing3}`,
    borderRadius: dimensions.radiusSm,
    fontSize: dimensions.fontSizeSm,
    color: colors.foreground,
    background: "none",
    border: "none",
    cursor: "pointer",
    ":hover": { backgroundColor: colors.surfaceStrong },
  },
  signOut: {
    marginTop: dimensions.spacing1,
    paddingTop: dimensions.spacing2,
    color: colors.danger,
  },
});

export function UserMenu(props: { user: NavUser; onSignOut: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  let wrapRef: HTMLDivElement | undefined;

  const onDocClick = (e: MouseEvent) => {
    if (wrapRef && !wrapRef.contains(e.target as Node)) setOpen(false);
  };
  // 点击外部关闭：注册/清理都收在 onMount 内——SSR 下 onCleanup 顶层执行会访问 document 炸掉
  onMount(() => {
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  return (
    <div ref={wrapRef} {...stylex.props(styles.wrap)}>
      <button
        type="button"
        {...stylex.props(styles.trigger)}
        aria-label={props.user.name ?? props.user.email}
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <Avatar image={props.user.image} name={props.user.name} email={props.user.email} size={24} />
      </button>
      <Show when={open()}>
        <div role="menu" {...stylex.props(styles.menu)}>
          <div {...stylex.props(styles.identity)}>
            <span {...stylex.props(styles.name)}>{props.user.name || t("common.unnamed")}</span>
            <span {...stylex.props(styles.email)}>{props.user.email}</span>
          </div>
          <A role="menuitem" href="/me" {...stylex.props(styles.item)}>{t("nav.profile")}</A>
          <a role="menuitem" href="/me/episodes" {...stylex.props(styles.item)}>{t("me.episodes")}</a>
          <a role="menuitem" href="/me/submits" {...stylex.props(styles.item)}>{t("nav.submissions")}</a>
          <a role="menuitem" href="/me/playlists" {...stylex.props(styles.item)}>{t("me.playlists")}</a>
          <a role="menuitem" href="/account" {...stylex.props(styles.item)}>{t("nav.settings")}</a>
          <button
            type="button"
            role="menuitem"
            {...stylex.props(styles.item, styles.signOut)}
            onClick={props.onSignOut}
          >
            {t("nav.logout")}
          </button>
        </div>
      </Show>
    </div>
  );
}
