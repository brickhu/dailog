/** better-auth 轻量客户端（bearer token 模式，M5）：注册/登录/会话/登出 */

import { env } from "./env";

export const TOKEN_KEY = "dailogToken";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** better-auth 邮箱验证状态（注册后为 false，点击验证邮件后为 true） */
  emailVerified: boolean;
}

export interface SignUpInput {
  email: string;
  password: string;
  name: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  // credentials: "include"：登录/登出响应 Set-Cookie 需被浏览器接受（SSO cookie 会话），
  // 否则 cookie 会话永远不会建立，只能靠 localStorage token 兜底
  const res = await fetch(`${env.apiBaseUrl}${path}`, { ...init, credentials: "include" });
  return res;
}

/** 非 2xx → 抛 better-auth/Hono 错误消息（message（better-auth）或 error（业务路由）） */
async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? `http_${res.status}`);
  }
  return res;
}

export function persistToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export const authApi = {
  async signUp(input: SignUpInput): Promise<{ token: string; user: AuthUser }> {
    const res = await expectOk(
      await request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    const data = (await res.json()) as { token: string; user: AuthUser };
    persistToken(data.token);
    return data;
  },

  async signIn(input: SignInInput): Promise<{ token: string; user: AuthUser }> {
    const res = await expectOk(
      await request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    const data = (await res.json()) as { token: string; user: AuthUser };
    persistToken(data.token);
    return data;
  },

  /** 启动恢复：Bearer 会话验证；无效/过期返回 null */
  async getSession(token: string): Promise<AuthUser | null> {
    const res = await request("/api/auth/get-session", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser };
    return data.user ?? null;
  },

  /** 授权码开通频道（注册开放；生成/发布前需开通）；token 可为 null——SSO cookie 会话无需 Bearer */
  async activateChannel(token: string | null, inviteCode: string): Promise<void> {
    const res = await expectOk(
      await request("/api/me/channel/activate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ inviteCode }),
      }),
    );
    await res.json();
  },

  /** 重发验证邮件（better-auth: POST send-verification-email { email, callbackURL }） */
  async resendVerification(email: string, callbackURL: string): Promise<void> {
    await expectOk(
      await request("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, callbackURL }),
      }),
    );
  },

  /** 登出：token 存在时带 Bearer；cookie 会话由 credentials include 携带，服务端清 cookie */
  async signOut(token: string | null): Promise<void> {
    await request("/api/auth/sign-out", {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => {});
    clearToken();
  },
};
