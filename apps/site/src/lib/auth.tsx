import {
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  useContext,
  type ParentProps,
} from "solid-js";
import type { NavUser } from "../components/user-menu";

/**
 * 全局认证上下文（AppShell 单实例）：
 * - user / unread / status 响应式状态，SSR 首帧为 null/0/"loading"
 * - refresh()：重新拉取 /v1/me/overview（登录成功/登出后调用）
 * - signOut()：登出（POST sign-out + 清状态）
 * 组件内用 useAuth()；use:auth 指令等在事件回调中拿不到 Context，用
 * getAuthSnapshot()（模块级同步快照，refresh/signOut 时更新）。
 *
 * 为什么不用整页刷新/事件：
 * - 整页刷新（window.location.href）会重拉全部资源——部署切换/缓存不一致时可能拿到
 *   SPA fallback 顶替的坏壳（iOS 登录跳回首页卡死，见 MEMORY/dev-guide），故登录/登出
 *   一律 SPA 内导航 + context 驱动刷新。
 * - 事件（CustomEvent）也可行但无类型、易失配；context 是 Solid 一等公民，响应式联动。
 */

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface AuthContextValue {
  user: () => NavUser | null;
  unread: () => number;
  status: () => AuthStatus;
  /** 重新拉取用户态（登录/登出后调用；Header 等消费方自动响应） */
  refresh: () => Promise<void>;
  /** 登出：POST sign-out → 清状态 → 触发监听者刷新 */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// —— 模块级同步快照（use:auth 指令事件回调里读；refresh/signOut 时更新）——
let snapshotUser: NavUser | null = null;
let snapshotStatus: AuthStatus = "loading";

/** 读取当前登录态快照（同步；供 use:auth 指令等非组件上下文使用） */
export function getAuthSnapshot(): { user: NavUser | null; status: AuthStatus } {
  return { user: snapshotUser, status: snapshotStatus };
}

export function AuthProvider(props: ParentProps) {
  const [user, setUser] = createSignal<NavUser | null>(null);
  const [unread, setUnread] = createSignal(0);
  const [status, setStatus] = createSignal<AuthStatus>("loading");

  // 同步快照（状态变化即更新，供 use:auth 指令读取）
  createEffect(() => {
    snapshotUser = user();
    snapshotStatus = status();
  });

  /** 拉取聚合端点：一次请求替代 get-session + profile + 未读数三连 */
  const refresh = async () => {
    try {
      const res = await fetch("/v1/me/overview");
      if (!res.ok) {
        setUser(null);
        setUnread(0);
        setStatus("unauthenticated");
        return;
      }
      const data = (await res.json()) as {
        user?: { id?: string; name?: string | null; email?: string; image?: string | null } | null;
        nickname?: string | null;
        unreadCount?: number;
      } | null;
      const u = data?.user;
      if (!u?.email) {
        setUser(null);
        setUnread(0);
        setStatus("unauthenticated");
        return;
      }
      // 主持人主页地址 = 账号昵称（@slug = user.name）
      setUser({ id: u.id ?? "", name: u.name ?? null, email: u.email, image: u.image ?? null, username: data?.nickname ?? null });
      setUnread(typeof data?.unreadCount === "number" ? data.unreadCount : 0);
      setStatus("authenticated");
    } catch {
      // 网络异常按未登录处理（不阻塞渲染）
      setUser(null);
      setUnread(0);
      setStatus("unauthenticated");
    }
  };

  /** 未读数单独刷新（窗口聚焦时；未登录直接跳过，避免 401 噪音） */
  const refreshUnread = async () => {
    if (!user()) return;
    try {
      const res = await fetch("/v1/me/notifications/unread");
      if (res.ok) setUnread((await res.json()).count ?? 0);
    } catch { /* 静默 */ }
  };

  /** 登出：清服务端会话 + 本地状态 */
  const signOut = async () => {
    try {
      await fetch("/v1/auth/sign-out", { method: "POST" });
    } catch { /* 忽略网络错误，本地照常登出 */ }
    setUser(null);
    setUnread(0);
    setStatus("unauthenticated");
  };

  onMount(() => {
    void refresh();
    window.addEventListener("focus", refreshUnread);
    onCleanup(() => window.removeEventListener("focus", refreshUnread));
  });

  const value: AuthContextValue = { user, unread, status, refresh, signOut };
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

/** 组件内读取认证上下文（必须在 AuthProvider 内；AppShell 已包裹） */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
