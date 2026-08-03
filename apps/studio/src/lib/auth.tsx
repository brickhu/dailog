import { createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { authApi, loadToken, clearToken, type AuthUser } from "./auth-api";
import { env } from "./env";
import { injectExtensionToken } from "./ext-inject";
import { setTokenGetter } from "./client";

// 认证上下文（M5：better-auth bearer 模式——token 内存 signal + localStorage 持久化）
export interface AuthState {
  user: AuthUser | null;
  /** 首帧会话恢复中（避免守卫误跳 auth） */
  loading: boolean;
  token: () => string | null;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signUp(email: string, password: string, name: string): Promise<{ error: string | null }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState>();

export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<AuthUser | null>(null);
  const [loading, setLoading] = createSignal(true);
  // api 客户端需要同步取 token，随会话事件维护缓存
  const [accessToken, setAccessToken] = createSignal<string | null>(null);

  onMount(async () => {
    // 无论是否已有 token，先注册 token getter（注册/登录后 accessToken signal 更新即生效；
    // 若不注册，未登录进入页面的会话在注册后 api client 仍拿不到 token）
    setTokenGetter(() => accessToken());
    // ① SSO cookie 会话优先：跨子域 cookie（.dailogues.com）已登录则免登录
    const sessionUser = await fetch(`${env.apiBaseUrl}/api/auth/get-session`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ user: AuthUser | null }>) : Promise.resolve({ user: null })))
      .catch(() => ({ user: null }));
    if (sessionUser.user) {
      setUser(sessionUser.user);
      setLoading(false);
      // 自动注入扩展 token（页面加载即续上）
      void injectExtensionToken();
      return;
    }
    // ② 备用：localStorage token 恢复（dev 兜底 / 备用登录页）
    const token = loadToken();
    if (!token) {
      setLoading(false);
      return;
    }
    const sessionUser2 = await authApi.getSession(token).catch(() => null);
    if (sessionUser2) {
      setUser(sessionUser2);
      setAccessToken(token);
    } else {
      clearToken();
    }
    setLoading(false);
  });

  const value: AuthState = {
    get user() { return user(); },
    get loading() { return loading(); },
    token: () => accessToken(),
    async signIn(email, password) {
      try {
        const { token, user: u } = await authApi.signIn({ email, password });
        setAccessToken(token);
        setUser(u);
        void injectExtensionToken();
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "登录失败" };
      }
    },
    async signUp(email, password, name) {
      try {
        const { token, user: u } = await authApi.signUp({ email, password, name });
        setAccessToken(token);
        setUser(u);
        void injectExtensionToken();
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "注册失败" };
      }
    },
    async signOut() {
      const token = accessToken();
      if (token) await authApi.signOut(token);
      setAccessToken(null);
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return ctx;
}
