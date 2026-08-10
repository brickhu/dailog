import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createCorsMiddleware } from "../cors";

const ALLOWED = ["https://dailog.pages.dev", "http://localhost:5173"];

/** 模拟 better-auth 形态的 handler：直接返回裸 Response（不走 c.json/c.body）——
 *  历史 bug：Hono 的 c.header() 不会合并进裸响应，导致 GET/POST 丢 CORS 头而 OPTIONS 正常 */
function buildApp() {
  const app = new Hono();
  app.use("*", createCorsMiddleware(ALLOWED));
  app.get("/v1/auth/get-session", () =>
    new Response(JSON.stringify({ user: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  app.post("/v1/auth/sign-in/email", () =>
    new Response(JSON.stringify({ error: "invalid" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return app;
}

describe("createCorsMiddleware（裸 Response 场景）", () => {
  it("GET 白名单 Origin → 响应带 ACAO/ACAC（此前丢失）", async () => {
    const res = await buildApp().request("/v1/auth/get-session", {
      headers: { Origin: "https://dailog.pages.dev" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://dailog.pages.dev");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("POST 白名单 Origin → 响应带 ACAO", async () => {
    const res = await buildApp().request("/v1/auth/sign-in/email", {
      method: "POST",
      headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  it("OPTIONS 预检 → 204 + ACAO", async () => {
    const res = await buildApp().request("/v1/auth/sign-in/email", {
      method: "OPTIONS",
      headers: {
        Origin: "https://dailog.pages.dev",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://dailog.pages.dev");
  });

  it("非白名单 Origin → 不加任何 CORS 头", async () => {
    const res = await buildApp().request("/v1/auth/get-session", {
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
