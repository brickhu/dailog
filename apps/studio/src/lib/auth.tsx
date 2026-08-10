import { createContext, createSignal, onMount, useContext, type JSX } from "solid-js";
import { authApi, loadToken, clearToken, type AuthUser } from "./auth-api";
import { api, setTokenGetter } from "./client";

// 认证上下文（M5：better-auth bearer 模式——token 内存 signal + localStorage 持久化）
export interface AuthState {
  user: AuthUser | null;
  /** 首帧会话恢复中（避免守卫误跳 auth） */
  loading: boolean;
  token: () => string | null;
  /** 频道开通状态：null = 未知（恢复/拉取中）；false = 未开通（守卫强制去 /onboarding） */
  channelActive: () => boolean | null;
  /** 声音样本是否已上传：null = 未知；false = 开通了但未录音（守卫锁定 onboarding 第二步） */
  hasVoiceSample: () => boolean | null;
  signIn(email: string, password: string): Promise<{ error: string | null }>;
  signUp(email: string, password: string, name: string): Promise<{ error: string | null }>;
  /** 重发验证邮件到当前用户邮箱（验证链接跳回当前站点） */
  resendVerification(): Promise<{ error: string | null }>;
  /** 授权码开通频道：成功后同步 channelActive（守卫据此跳转工作台） */
  activateChannel(inviteCode: string): Promise<{ error: string | null; code?: string | null }>;
  /** 录音上传成功后调用：同步 hasVoiceSample（守卫放行进入工作台） */
  markVoiceSampleUploaded(): void;
  /** 会话失效（401）本地清理：清内存 user + localStorage token →
   *  第一层锁定（登录界面）自动出现，URL 不变，重新登录后回到原路径 */
  expireSession(): void;
  /** 登录成功后同步会话状态（锁定视图用：LoginForm 内部已调 sign-in API，
   *  这里只落状态触发第一层解锁；persist/inject 由调用方负责） */
  applySession(user: AuthUser | null, token: string | null): void;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState>();

export function AuthProvider(props: { children: JSX.Element }) {
  const [user, setUser] = createSignal<AuthUser | null>(null);
  const [loading, setLoading] = createSignal(true);
  // api 客户端需要同步取 token，随会话事件维护缓存
  const [accessToken, setAccessToken] = createSignal<string | null>(null);
  const [channelActive, setChannelActive] = createSignal<boolean | null>(null);
  const [hasVoiceSample, setHasVoiceSample] = createSignal<boolean | null>(null);

  /** 拉取频道开通/录音状态（/api/me 走 better-auth 会话：cookie 或 Bearer 均可） */
  const refreshChannel = async () => {
    try {
      const me = await api.get<{ channelActive: boolean; hasVoiceSample: boolean }>("/v1/me");
      setChannelActive(me.channelActive);
      setHasVoiceSample(me.hasVoiceSample);
    } catch {
      setChannelActive(null);
      setHasVoiceSample(null);
    }
  };

  onMount(async () => {
    // 无论是否已有 token，先注册 token getter（注册/登录后 accessToken signal 更新即生效；
    // 若不注册，未登录进入页面的会话在注册后 api client 仍拿不到 token）
    setTokenGetter(() => accessToken());
    // ① SSO cookie 会话优先：跨子域 cookie（.dailog.fm）已登录则免登录
    // 注意：better-auth 未登录时 get-session 返回 JSON null（而非 {user:null}），
    // 必须整体走可选链——历史上 sessionUser.user 在 null 上抛 TypeError，
    // onMount 中断导致 auth.loading 永久 true（守卫卡"加载中"）。
    const loggedUser = await fetch(`/v1/auth/get-session`, {
      credentials: "include",
      // 恢复会话不无限等待：10s 超时后按未登录处理（否则 fetch 挂起 → 永久"加载中"）
      signal: AbortSignal.timeout(10_000),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ user: AuthUser } | null>) : Promise.resolve(null)))
      .catch(() => null);
    const user = loggedUser?.user ?? null;
    if (user) {
      setUser(user);
      setLoading(false);
      void refreshChannel();
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
    void refreshChannel();
  });

  const value: AuthState = {
    get user() { return user(); },
    get loading() { return loading(); },
    token: () => accessToken(),
    channelActive: () => channelActive(),
    hasVoiceSample: () => hasVoiceSample(),
    async signIn(email, password) {
      try {
        const { token, user: u } = await authApi.signIn({ email, password });
        setAccessToken(token);
        setUser(u);
        void refreshChannel();
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
        void refreshChannel();
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "注册失败" };
      }
    },
    async resendVerification() {
      const u = user();
      if (!u) return { error: "未登录" };
      try {
        // callbackURL = 当前站点：点击验证链接后跳回（从哪里来就返回哪里去）
        await authApi.resendVerification(u.email, window.location.origin);
        return { error: null };
      } catch (e) {
        return { error: e instanceof Error ? e.message : "发送失败" };
      }
    },
    async activateChannel(inviteCode) {
      try {
        // token 可为 null（SSO cookie 会话无需 Bearer，authApi 带 credentials include）
        await authApi.activateChannel(accessToken(), inviteCode);
        setChannelActive(true);
        return { error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "开通失败";
        return { error: msg, code: msg.includes("invalid_invite_code") ? "invalid_invite_code" : null };
      }
    },
    markVoiceSampleUploaded() {
      setHasVoiceSample(true);
    },
    async signOut() {
      // cookie 会话下 token 为 null 也要调服务端登出（清 better-auth cookie）
      await authApi.signOut(accessToken());
      setAccessToken(null);
      setUser(null);
      setChannelActive(null);
      setHasVoiceSample(null);
    },
    expireSession() {
      // 会话已失效（服务端 401）：不再调登出 API（必然失败），仅本地清理触发锁定
      setAccessToken(null);
      setUser(null);
      setChannelActive(null);
      setHasVoiceSample(null);
      clearToken();
    },
    applySession(user, token) {
      if (user) setUser(user);
      setAccessToken(token);
      void refreshChannel();
    },
  };

  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return ctx;
}
