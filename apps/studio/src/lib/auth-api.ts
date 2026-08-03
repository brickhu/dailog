/** better-auth 轻量客户端（bearer token 模式，M5）：注册/登录/会话/登出 */

import { env } from "./env";

export const TOKEN_KEY = "dailoguesToken";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
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
  const res = await fetch(`${env.apiBaseUrl}${path}`, init);
  return res;
}

/** 非 2xx → 抛 better-auth 错误消息（如 invalid_invite_code） */
async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `http_${res.status}`);
  }
  return res;
}

function persistToken(token: string): void {
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

  /** 授权码开通频道（注册开放；生成/发布前需开通） */
  async activateChannel(token: string, inviteCode: string): Promise<void> {
    const res = await expectOk(
      await request("/api/me/channel/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ inviteCode }),
      }),
    );
    await res.json();
  },

  async signOut(token: string): Promise<void> {
    await request("/api/auth/sign-out", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    clearToken();
  },
};
