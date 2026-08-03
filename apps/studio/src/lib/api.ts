/** 前端 API 客户端：统一 baseUrl、Bearer 注入、错误规范化 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail?: string,
  ) {
    super(`${code} (http ${status})${detail ? `: ${detail}` : ""}`);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** 每次请求取当前 JWT；null = 无 Bearer（SSO cookie 会话仍可认证：请求照发，未认证由服务端 401） */
  getToken: () => string | null;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  /** 原生请求（音频流、SSE 用）：仍带 Bearer，不解析 JSON */
  request(path: string, init?: RequestInit): Promise<Response>;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    // 无 token 不拦截：cookie 会话（credentials: "include"）可独立认证；
    // 有 token（登录响应/扩展注入）附加 Bearer；真正未认证由服务端 401 统一规范化。
    const token = opts.getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    // credentials: "include"——SSO cookie 会话（跨子域同站 cookie 自动携带；本地跨端口 localhost 同理）
    const res = await fetch(`${opts.baseUrl}${path}`, { ...init, headers, credentials: "include" });
    if (res.status === 401 && res.headers.get("content-type")?.includes("json")) {
      // 后端 401（token 过期/无效）：透传 code，前端据此登出
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(401, body?.error ?? "unauthorized");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
      throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body?.detail);
    }
    return res;
  };

  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await request(path, init);
    return (await res.json()) as T;
  };

  return {
    get: <T>(path: string) => json<T>(path),
    post: <T>(path: string, body?: unknown) =>
      json<T>(path, { method: "POST", body: body === undefined ? undefined : serializeBody(body) }),
    put: <T>(path: string, body?: unknown) =>
      json<T>(path, { method: "PUT", body: body === undefined ? undefined : serializeBody(body) }),
    request,
  };
}

/** JSON 序列化；FormData 原样透传（multipart 场景） */
function serializeBody(body: unknown): BodyInit | undefined {
  if (body instanceof FormData) return body;
  return JSON.stringify(body);
}
