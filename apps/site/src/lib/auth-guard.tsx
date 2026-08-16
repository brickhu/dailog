// 全局登录守卫（use:auth 指令 + 登录/注册引导 Dialog）：
// - 需要登录的按钮/链接挂 use:auth —— 点击时检查登录态：
//   已登录 → 直接放行，执行元素自身绑定的事件（onClick 等）；
//   未登录 → 拦截点击，弹出统一引导 Dialog（登录 or 注册，跳 /login 并带回跳）
// - 登录态检测走 /v1/me（同源代理，401 = 未登录），结果会话内缓存
//   （登录/登出后调用 resetAuthCache 重置）
import { createSignal } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { Button, Dialog } from "@dailogues/ui";
import * as stylex from "@stylexjs/stylex";
import { colors, dimensions } from "@dailogues/ui/theme.stylex";

export interface AuthGuardOptions {
  /** 登录/注册成功后回跳路径（默认当前路径） */
  redirect?: string;
}

// —— 登录态（会话内缓存）——
let loggedIn: boolean | null = null;

/** 当前是否已登录（未检查过则请求 /v1/me；401/网络异常 = 未登录） */
export async function isLoggedIn(): Promise<boolean> {
  if (loggedIn != null) return loggedIn;
  try {
    const r = await fetch("/v1/me");
    // 200 且响应为 JSON 才算已登录（代理缺失时 SPA fallback 会返回 200 + HTML）
    loggedIn = r.status === 200 && (r.headers.get("content-type") ?? "").includes("application/json");
  } catch {
    loggedIn = false;
  }
  return loggedIn;
}

/** 登录/登出后重置登录态缓存 */
export function resetAuthCache(): void {
  loggedIn = null;
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
        <p {...stylex.props(styles.title)}>需要登录</p>
        <p {...stylex.props(styles.desc)}>
          登录或注册后即可继续操作（新用户可直接注册，老用户密码登录）。
        </p>
        <div {...stylex.props(styles.actions)}>
          <Button onClick={goLogin}>去登录 / 注册</Button>
          <Button onClick={() => setAuthDialogOpen(false)}>
            取消
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

// —— use:auth 指令 ——
// 挂载后点击拦截：capture 阶段先于元素自身 onClick（冒泡）执行；
// 已登录 → 放行（执行绑定事件）；未登录 → preventDefault/stopPropagation + 弹引导层
export function auth(el: HTMLElement, accessor: () => AuthGuardOptions | undefined) {
  const handler = async (e: Event) => {
    const ok = await isLoggedIn();
    if (ok) return; // 已登录：放行，执行绑定的事件函数
    e.preventDefault();
    e.stopPropagation();
    openAuthDialog(accessor()?.redirect);
  };
  el.addEventListener("click", handler, true);
  return () => el.removeEventListener("click", handler, true);
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      // 无参 use:auth 时 Solid 传入 true（boolean）
      auth: AuthGuardOptions | true | undefined;
    }
  }
}
