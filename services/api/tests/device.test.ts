import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { devicePublicRoutes, createDeviceStore } from "../src/routes/device";
import type { Env } from "../src/config/env";

// 设备授权流（配对码）测试：API 域内自包含授权页——不依赖 site。
// 覆盖：创建授权 / 授权页（未登录表单 / 已登录自动授权 + 配对码 / 无权限 / 过期）/ 配对码换 token

function fakeAuth(session: { user: { id: string }; session?: { token?: string } } | null) {
  return {
    api: { getSession: async () => session },
    handler: async () => new Response("", { status: 404 }),
  };
}

function fakeEnv(): Env {
  return {
    DATABASE_URL: "postgres://localhost:5432/dailog",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost:8787",
    SITE_BASE_URL: "https://dailog.fm",
    PORT: 8787,
    FISH_API_KEY: "",
    STORAGE_DRIVER: "fs",
    STORAGE_DIR: "./data",
    APP_ORIGINS: "",
    RESEND_API_KEY: "",
    EMAIL_FROM: "dailog <no-reply@dailog.fm>",
    ADMIN_EMAILS: "",
  };
}

function makeApp(opts: {
  session?: { user: { id: string }; session?: { token?: string } } | null;
  role?: string | null;
} = {}) {
  const store = createDeviceStore();
  const app = new Hono();
  app.route("/", devicePublicRoutes(store, fakeEnv(), fakeAuth(opts.session ?? null), async () => opts.role ?? null));
  return { app, store };
}

describe("POST /v1/device（创建授权）", () => {
  it("返回 deviceCode（无 verificationUrl——链接由 Agent 本地拼装）", async () => {
    const { app } = makeApp();
    const res = await app.request("/v1/device", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deviceCode: string; verificationUrl?: string };
    expect(body.deviceCode).toBeTruthy();
    expect(body.verificationUrl).toBeUndefined();
  });
});

describe("GET /v1/device/authorize（API 域内授权页，不依赖 site）", () => {
  it("未登录 → 返回内联登录表单（含 sign-in/email 提交脚本）", async () => {
    const { app, store } = makeApp({ session: null });
    const { deviceCode } = store.create();
    const res = await app.request(`/v1/device/authorize?code=${deviceCode}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("登录并授权");
    expect(html).toContain("/v1/auth/sign-in/email");
  });

  it("已登录（editor 角色）→ 自动授权并显示配对码", async () => {
    const { app, store } = makeApp({
      session: { user: { id: "editor-1" }, session: { token: "tok-1" } },
      role: "editor",
    });
    const { deviceCode, userCode } = store.create();
    const res = await app.request(`/v1/device/authorize?code=${deviceCode}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("授权成功");
    // 页面显示格式化配对码（8 位分组：G88S-DPDV）
    expect(html).toContain(`${userCode.slice(0, 4)}-${userCode.slice(4)}`);
    // grant 已被授权（token 已签发）
    expect(store.get(deviceCode)?.approved).toBe(true);
    expect(store.get(deviceCode)?.token).toBe("tok-1");
  });

  it("已登录但无编辑权限 → 拒绝页，不授权", async () => {
    const { app, store } = makeApp({
      session: { user: { id: "user-1" }, session: { token: "tok-1" } },
      role: "user",
    });
    const { deviceCode } = store.create();
    const res = await app.request(`/v1/device/authorize?code=${deviceCode}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("没有编辑权限");
    expect(store.get(deviceCode)?.approved).toBe(false);
  });

  it("授权码不存在/过期 → 过期页", async () => {
    const { app } = makeApp({ session: { user: { id: "editor-1" }, session: { token: "t" } }, role: "editor" });
    const res = await app.request("/v1/device/authorize?code=nonexistent");
    expect(await res.text()).toContain("授权链接已过期");
  });
});

describe("POST /v1/device/pair（配对码换 token）", () => {
  it("授权后提交配对码 → 一次性返回 token；二次使用 409", async () => {
    const { app, store } = makeApp({
      session: { user: { id: "editor-1" }, session: { token: "tok-1" } },
      role: "editor",
    });
    const { deviceCode, userCode } = store.create();
    // 浏览器授权页完成授权
    await app.request(`/v1/device/authorize?code=${deviceCode}`);
    // Agent 提交配对码
    const res = await app.request("/v1/device/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "approved", token: "tok-1" });
    // 二次使用 → 409
    const again = await app.request("/v1/device/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
    });
    expect(again.status).toBe(409);
    expect((await again.json()) as { error: string }).toMatchObject({ error: "already_used" });
  });

  it("未授权先提交 → 409 提示先完成浏览器授权", async () => {
    const { app, store } = makeApp();
    const { userCode } = store.create();
    const res = await app.request("/v1/device/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "not_approved" });
  });
});
