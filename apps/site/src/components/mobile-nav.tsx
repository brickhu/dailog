import { type JSX } from "solid-js";
import { Drawer } from "@dailogues/ui";
import { useI18n } from "@dailogues/i18n";

/**
 * 站点移动导航抽屉（site 范围组件，基于通用 Drawer）：
 * - 配置站点导航：标题（t("mobileNav.navigation")）、宽度 320px
 * - 内容由消费方传入（SideNav 菜单等），如 site-nav.tsx
 * - 汉堡按钮与打开状态由 site-nav.tsx 管理（aria-controls 指向传入的 id）
 */
export function MobileNav(props: {
  /** drawer dialog 的 id（汉堡按钮 aria-controls 指向它） */
  id: string;
  /** 是否打开（受控） */
  isOpen: boolean;
  /** 请求关闭时回调 */
  onOpenChange: (isOpen: boolean) => unknown;
  /** 抽屉内容（SideNav 导航菜单等） */
  children: JSX.Element;
}) {
  const { t } = useI18n();
  return (
    <Drawer
      id={props.id}
      isOpen={props.isOpen}
      onOpenChange={props.onOpenChange}
      header={t("mobileNav.navigation")}
      width={320}
    >
      {props.children}
    </Drawer>
  );
}

MobileNav.displayName = "MobileNav";
