import { createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { api } from "./client";

// 管理员工作台认证上下文（简化版：无频道/录音状态——admin 仅需要登录 + 角色）
export type AdminRole = "user" | "editor" | "admin";

export interface AuthUser { id: string; email: string; name: string; emailVerified: boolean; }

export interface AuthState {
  user: () => AuthUser | null;
  /** 首帧会话恢复中（避免守卫误跳 auth） */
  loading: () => boolean;
  /** 当前用户角色：null = 未知；非 editor/admin 时守卫显示无权限 */
  role: () => AdminRole | null;
  /** 登录成功后同步会话状态（LoginForm 已调 sign-in API，cookie 由浏览器保存） */
  applySession(): Promise<void>;
  expireSession(): void;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState>();

export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<AuthUser | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [role, setRole] = createSignal<AdminRole | null>(null);

  /** 拉取当前会话（cookie 模式：经 vite proxy 同源转发，浏览器自动携带 cookie） */
  const fetchSession = async (): Promise<AuthUser | null> => {
    const res = await fetch("/v1/auth/get-session");
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id?: string; email?: string; name?: string; emailVerified?: boolean } | null } | null;
    if (!data?.user?.id) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? "",
      name: data.user.name ?? "",
      emailVerified: Boolean(data.user.emailVerified),
    };
  };

  /** 拉取角色（/v1/me 返回 role；非 editor/admin 由守卫拦截） */
  const refreshRole = async () => {
    try {
      const me = await api.get<{ role?: AdminRole }>("/v1/me");
      setRole(me.role ?? "user");
    } catch {
      setRole(null);
    }
  };

  onMount(async () => {
    // cookie 会话恢复（site/admin 共享同一 Domain cookie——SSO）
    const u = await fetchSession();
    setUser(u);
    if (u) await refreshRole();
    setLoading(false);
  });

  const applySession = async () => {
    // 登录成功：cookie 已由浏览器保存，直接同步会话
    const u = await fetchSession();
    setUser(u);
    if (u) await refreshRole();
  };

  const expireSession = () => {
    setUser(null);
    setRole(null);
  };

  const signOut = async () => {
    await fetch("/v1/auth/sign-out", { method: "POST" }).catch(() => {});
    expireSession();
    window.location.reload();
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      role,
      applySession,
      expireSession,
      signOut,
    }}>
      {props.children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
