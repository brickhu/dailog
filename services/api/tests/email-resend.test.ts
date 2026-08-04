import { describe, expect, it, vi, afterEach } from "vitest";
import { sendEmail } from "../src/email/resend";
import type { Env } from "../src/config/env";

// sendEmail：Resend 事务邮件（纯 fetch）——key 缺失静默跳过；成功/失败路径
const baseEnv = {
  DATABASE_URL: "",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:8787",
  PORT: 8787,
  DEEPSEEK_API_KEY: "",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1",
  DEEPSEEK_MODEL: "deepseek-chat",
  FISH_API_KEY: "",
  STORAGE_DRIVER: "fs" as const,
  STORAGE_DIR: "./data",
  ASSETS_DIR: "assets/audio",
  APP_ORIGINS: "",
  POLISH_MAX_VERSIONS: 5,
  RESEND_API_KEY: "",
  EMAIL_FROM: "dailog <no-reply@dailog.fm>",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendEmail (Resend)", () => {
  it("RESEND_API_KEY 未配置 → 静默跳过（不发请求、不抛错）", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await sendEmail(baseEnv as Env, { to: "a@test.local", subject: "s", html: "<p>x</p>" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("成功：POST https://api.resend.com/emails，带 Bearer + 正确载荷", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    await sendEmail(
      { ...baseEnv, RESEND_API_KEY: "re_secret" } as Env,
      { to: "a@test.local", subject: "验证邮件", html: "<p>hi</p>" },
    );
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer re_secret");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      from: "dailog <no-reply@dailog.fm>",
      to: ["a@test.local"],
      subject: "验证邮件",
      html: "<p>hi</p>",
    });
  });

  it("失败：非 2xx → 抛错（含状态码与响应片段）", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    await expect(
      sendEmail(
        { ...baseEnv, RESEND_API_KEY: "re_secret" } as Env,
        { to: "a@test.local", subject: "s", html: "<p>x</p>" },
      ),
    ).rejects.toThrow("resend 发送失败（429）: rate limited");
  });
});
