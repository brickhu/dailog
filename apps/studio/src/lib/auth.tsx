import { createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { env } from "./env";

// 认证上下文：supabase-js 会话管理 + api JWT 供给 + 路由守卫用状态
export interface AuthState {
  client: SupabaseClient;
  user: User | null;
  /** 首帧 session 恢复中（避免守卫误跳 auth） */
  loading: boolean;
  token: () => string | null;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signUp(email: string, password: string): Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState>();

export function AuthProvider(props: { children: JSX.Element }) {
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey);
  const [user, setUser] = createSignal<User | null>(null);
  const [loading, setLoading] = createSignal(true);
  // api 客户端需要同步取 token（createApiClient.getToken 是同步函数），随会话事件维护缓存
  const [accessToken, setAccessToken] = createSignal<string | null>(null);

  onMount(async () => {
    const { data } = await client.auth.getSession();
    setUser(data.session?.user ?? null);
    setAccessToken(data.session?.access_token ?? null);
    setLoading(false);
    // 登出/过期/刷新时同步
    client.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAccessToken(session?.access_token ?? null);
    });
  });

  const value: AuthState = {
    client,
    get user() { return user(); },
    get loading() { return loading(); },
    token: () => accessToken(),
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      // Supabase 开了邮箱确认时 session 为空 → 前端提示查收邮件
      return { error: error?.message ?? null, needsConfirmation: !error && !data.session };
    },
    async signOut() {
      await client.auth.signOut();
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
