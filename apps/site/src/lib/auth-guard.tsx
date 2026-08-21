// 全局登录守卫（use:auth 指令 + 登录/注册引导 Dialog）：
// - 需要登录的按钮/链接挂 use:auth —— 点击时检查登录态：
//   已登录 → 直接放行，执行元素自身绑定的事件（onClick 等）；
//   未登录 → 拦截点击，弹出统一引导 Dialog（登录 or 注册，跳 /login 并带回跳）
// - 登录态检测走 /v1/me（同源代理，401 = 未登录）；权威状态在 AuthProvider
//   （lib/auth.ts）——组件用 useAuth()，use:auth 指令事件回调用 getAuthSnapshot()。
import { createSignal } from "solid-js";
import { useI18n } from "@dailogues/i18n";
import { useLocation, useNavigate } from "@solidjs/router";
import { Button, Dialog, registerDirective } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";
import { getAuthSnapshot, useAuth } from "./auth";

export interface AuthGuardOptions {
  /** 登录/注册成功后回跳路径（默认当前路径） */
  redirect?: string;
}

/** 当前是否已登录（同步读 AuthProvider 快照；loading 视为未确认——由调用方异步兜底） */
export function isLoggedIn(): boolean {
  return getAuthSnapshot().status === "authenticated";
}

/** 异步确认登录态（快照未确认时发 /v1/me 兜底；SPA fallback 响应为 200+HTML，
 *  必须校验 content-type 才算已登录——否则代理缺失时误判为已登录） */
export async function confirmLoggedIn(): Promise<boolean> {
  const snap = getAuthSnapshot();
  if (snap.status === "authenticated") return true;
  if (snap.status === "unauthenticated") return false;
  try {
    const r = await fetch("/v1/me");
    return r.status === 200 && (r.headers.get("content-type") ?? "").includes("application/json");
  } catch {
    return false;
  }
}

// —— 全局登出确认（AppShell 挂载单例；confirmSignOut 打开，确认才执行登出）——
const [signOutOpen, setSignOutOpen] = createSignal(false);

/** 打开退出登录确认守卫（用户确认后才真正登出） */
export function confirmSignOut(): void {
  setSignOutOpen(true);
}

/** 全局登出确认弹层 */
export function SignOutConfirmDialog() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const doSignOut = async () => {
    setSignOutOpen(false);
    await signOut();
    // SPA 导航回首页（不整页刷新——避免重拉全部资源时撞上部署切换/缓存坏壳；
    // 用户态由 AuthProvider 清空，Header 等消费方自动响应）
    navigate("/");
  };
  return (
    <Dialog isOpen={signOutOpen()} onOpenChange={setSignOutOpen} width={380} purpose="form">
      <div {...stylex.props(styles.wrap)}>
        <p {...stylex.props(styles.title)}>{t("auth.signOutTitle")}</p>
        <p {...stylex.props(styles.desc)}>{t("auth.signOutDesc")}</p>
        <div {...stylex.props(styles.actions)}>
          <Button onClick={doSignOut}>{t("auth.signOutConfirm")}</Button>
          <Button onClick={() => setSignOutOpen(false)}>
            {t("auth.guardCancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// —— 全局引导 Dialog（AppShell 挂载单例；openAuthDialog 打开）——
const [authDialogOpen, setAuthDialogOpen] = createSignal(false);
let pendingRedirect: string | null = null;

/** 打开登录/注册引导弹层（未登录点击时由 use:auth 调用；也可手动调用） */
export function openAuthDialog(redirect?: string): void {
  pendingRedirect = redirect ?? null;
  setAuthDialogOpen(true);
}

const styles = stylex.create({
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: dimensions.spacing4,
    padding: `${dimensions.spacing2} 0`,
  },
  title: {
    fontSize: dimensions.fontSizeXl,
    fontWeight: dimensions.fontWeightBold,
    margin: 0,
  },
  desc: {
    color: colors.neutral,
    fontSize: dimensions.fontSizeMd,
    margin: 0,
    lineHeight: 1.6,
  },
  actions: {
    display: "flex",
    gap: dimensions.spacing3,
    marginTop: dimensions.spacing2,
    flexWrap: "wrap",
  },
});

/** 全局登录引导弹层（AppShell 内挂载一次） */
export function AuthGuardDialog() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const goLogin = () => {
    setAuthDialogOpen(false);
    const target = pendingRedirect ?? location.pathname;
    navigate(`/login?redirect=${encodeURIComponent(target)}`);
  };
  return (
    <Dialog isOpen={authDialogOpen()} onOpenChange={setAuthDialogOpen} width={400} purpose="form">
      <div {...stylex.props(styles.wrap)}>
        <p {...stylex.props(styles.title)}>{t("auth.guardTitle")}</p>
        <p {...stylex.props(styles.desc)}>{t("auth.guardDesc")}</p>
        <div {...stylex.props(styles.actions)}>
          <Button onClick={goLogin}>{t("auth.guardAction")}</Button>
          <Button onClick={() => setAuthDialogOpen(false)}>
            {t("auth.guardCancel")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// —— use:auth 指令 ——
// 挂载后点击拦截：capture 阶段先于元素自身 onClick（冒泡）执行；
// 已登录 → 放行（执行绑定事件）；未登录 → preventDefault/stopPropagation + 弹引导层
export function auth(el: HTMLElement, accessor: () => unknown) {
  // 同步拦截：preventDefault/stopPropagation 必须在 await 前，否则 async 挂起期间事件
  // 继续冒泡，元素自身 onClick 会先执行（曾导致未登录直接跳转）。
  // 登录态读 AuthProvider 快照（权威状态）；loading（未确认）时也先拦截，异步兜底判断：
  // 已登录 → 手动重放点击（放行语义）；未登录 → 弹引导层。
  let replaying = false;
  const handler = (e: Event) => {
    if (replaying) return; // 重放点击：跳过拦截
    if (getAuthSnapshot().status === "authenticated") return; // 已登录：放行
    e.preventDefault();
    e.stopPropagation();
    // 快照未确认（loading）→ 请求 /v1/me 兜底（SPA fallback 时响应为 200+HTML，
    // 必须校验 content-type 才算已登录）
    const snap = getAuthSnapshot();
    if (snap.status === "unauthenticated") {
      const opts = accessor() as AuthGuardOptions | true | undefined;
      openAuthDialog(typeof opts === "object" ? opts?.redirect : undefined);
      return;
    }
    void (async () => {
      let ok = false;
      try {
        const r = await fetch("/v1/me");
        ok = r.status === 200 && (r.headers.get("content-type") ?? "").includes("application/json");
      } catch {
        ok = false;
      }
      if (ok) {
        replaying = true;
        el.click();
        replaying = false;
      } else {
        const opts = accessor() as AuthGuardOptions | true | undefined;
        openAuthDialog(typeof opts === "object" ? opts?.redirect : undefined);
      }
    })();
  };
  el.addEventListener("click", handler, true);
  return () => el.removeEventListener("click", handler, true);
}

// 注册到组件指令注册表：Button 等组件上的 use:auth 通过注册表应用到底层元素
registerDirective("auth", auth);

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      // 无参 use:auth 时 Solid 传入 true（boolean）
      auth: AuthGuardOptions | true | undefined;
    }
  }
}
