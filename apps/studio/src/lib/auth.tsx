import { createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { authApi, loadToken, clearToken, type AuthUser } from "./auth-api";
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
    const token = loadToken();
    if (!token) {
      setLoading(false);
      return;
    }
    // 恢复会话：localStorage token → getSession 验证（失效则清除）
    const sessionUser = await authApi.getSession(token).catch(() => null);
    if (sessionUser) {
      setUser(sessionUser);
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
