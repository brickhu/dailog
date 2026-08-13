// 设备授权流（配对码模式，Slack 式）——编辑本地 Agent 登录：
//   1. POST /v1/device            （免鉴权）创建授权 → { deviceCode, userCode(配对码), verificationUrl }
//   2. 编辑在浏览器打开 verificationUrl（site /login/device，带 deviceCode）→ 登录（已登录略过）
//      → 页面自动 POST /v1/device/approve（cookie 会话 + editor/admin 角色）→ 服务端签发
//      bearer token 存 grant → 页面显示【配对码】
//   3. 编辑把配对码复制回 Agent → 粘贴到终端 → POST /v1/device/pair（免鉴权）
//      → 校验配对码 + 已授权 → 返回 token → 写本地 session 文件（一次性，取后作废）
// 密码不落盘、不经 CLI；token 仅经配对码换取的本地通道下发。
//
// 存储：内存 Map（MVP 单实例；重启即失效——登录是一次性动作，重试即可）。
// 放 /v1/device/* 而非 /v1/auth/*（后者被 better-auth 全捕获吞掉）。

import { Hono } from "hono";
import { randomBytes, randomInt } from "node:crypto";
import { requireRole, type AuthEnv, type AuthLike } from "../middleware/auth";
import type { Env } from "../config/env";

interface DeviceGrant {
  deviceCode: string;
  /** 配对码（人可读短码，页面展示、用户复制回 Agent；一次性） */
  userCode: string;
  userId: string | null;
  token: string | null;
  approved: boolean;
  used: boolean;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 授权 5 分钟有效
// 配对码字符集：去易混字符（0/O/1/I）
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 配对码规范化（用户输入可能带横杠/空格/小写/全角横杠）——统一去分隔符后比对 */
export function normalizeUserCode(input: string): string {
  return input.trim().toUpperCase().replace(/[－—–]/g, "-").replace(/[\s-]/g, "");
}

/** 配对码展示格式化（存储无分隔符；页面显示加分组的可读码） */
export function formatUserCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function randomUserCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < 8; i++) chars.push(USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]);
  return chars.join("");
}

export interface DeviceStore {
  create(): { deviceCode: string; userCode: string };
  get(deviceCode: string): DeviceGrant | undefined;
  findByUserCode(userCode: string): DeviceGrant | undefined;
  approve(deviceCode: string, userId: string, token: string): void;
  markUsed(userCode: string): void;
}

/** 内存授权存储（单实例 MVP；启动即空） */
export function createDeviceStore(): DeviceStore {
  const grants = new Map<string, DeviceGrant>();
  return {
    create() {
      const deviceCode = randomBytes(16).toString("hex");
      const userCode = randomUserCode();
      grants.set(deviceCode, { deviceCode, userCode, userId: null, token: null, approved: false, used: false, expiresAt: Date.now() + TTL_MS });
      return { deviceCode, userCode };
    },
    get(deviceCode) {
      const grant = grants.get(deviceCode);
      if (!grant) return undefined;
      if (Date.now() > grant.expiresAt) {
        grants.delete(deviceCode);
        return undefined;
      }
      return grant;
    },
    findByUserCode(userCode) {
      for (const grant of grants.values()) {
        if (grant.userCode === userCode) return grant;
      }
      return undefined;
    },
    approve(deviceCode, userId, token) {
      const grant = grants.get(deviceCode);
      if (!grant) return;
      grant.userId = userId;
      grant.token = token;
      grant.approved = true;
    },
    markUsed(userCode) {
      for (const grant of grants.values()) {
        if (grant.userCode === userCode) {
          grant.used = true;
          return;
        }
      }
    },  };
}

export function devicePublicRoutes(store: DeviceStore, env: Env, auth: AuthLike, getRole: (userId: string) => Promise<string | null>) {
  const app = new Hono();

  /** 创建授权（免鉴权）：配对链接由 Agent 本地拼装（{apiBase}/v1/device/authorize?code=…），不依赖 site */
  app.post("/v1/device", async (c) => {
    const { deviceCode } = store.create();
    return c.json({ deviceCode });
  });

  /** 授权页（免鉴权，自包含 HTML——不依赖 site）：API 域内完成登录 + 授权 + 配对码展示
   *   · 已登录（api cookie 会话 + editor/admin 角色）→ 自动授权 → 显示配对码
   *   · 未登录 → 内联登录表单（同源 /v1/auth/sign-in/email → 成功后 reload 自动授权） */
  app.get("/v1/device/authorize", async (c) => {
    const deviceCode = c.req.query("code") ?? "";
    if (!deviceCode) {
      return c.html(page("授权失败", "<h1>缺少授权码</h1><p>请从 Agent 终端执行 pnpm editor login 获取授权链接</p>"));
    }
    const grant = store.get(deviceCode);
    if (!grant) {
      return c.html(page("授权已过期", "<h1>授权链接已过期</h1><p>请回到 Agent 终端重新执行 pnpm editor login</p>"));
    }
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session?.user) {
      return c.html(page("编辑授权 · 登录", `
        <h1>dailog 编辑授权</h1>
        <p>使用编辑账号登录（editor/admin 角色）——登录后自动完成授权</p>
        <form id="f">
          <input name="email" type="email" placeholder="邮箱" required>
          <input name="password" type="password" placeholder="密码" required>
          <button>登录并授权</button>
          <p class="err" id="err"></p>
        </form>
        <script>
        document.getElementById('f').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const res = await fetch('/v1/auth/sign-in/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') })
          });
          if (res.ok) { location.reload(); }
          else { document.getElementById('err').textContent = '登录失败，请检查邮箱与密码（需编辑账号）'; }
        });
        </script>`));
    }
    // 已登录：角色校验 → 自动授权 → 显示配对码
    const role = await getRole(session.user.id);
    if (role !== "editor" && role !== "admin") {
      return c.html(page("无编辑权限", "<h1>当前账号没有编辑权限</h1><p>请使用 editor/admin 角色账号登录（ADMIN_EMAILS 自动提升）</p>"));
    }
    const token = (session as unknown as { session?: { token?: string } })?.session?.token;
    if (!token) return c.html(page("会话异常", "<h1>会话异常</h1><p>请刷新页面重试</p>"));
    if (!grant.approved) store.approve(deviceCode, session.user.id, token);
    return c.html(page("授权成功", `
      <h1 class="ok">✅ 授权成功</h1>
      <p>复制下面的配对码，粘贴回 Agent 窗口：</p>
      <div class="code">${formatUserCode(grant.userCode)}</div>
      <p>配对码 5 分钟内有效，仅可使用一次。</p>`));
  });

  /** 配对码换 token（免鉴权；Agent 提交用户复制的配对码）：
   *  未授权 → 409 提示先完成浏览器授权；授权后一次性返回 token（取后作废） */
  app.post("/v1/device/pair", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { userCode?: unknown } | null;
    const userCode = normalizeUserCode(typeof body?.userCode === "string" ? body.userCode : "");
    if (!userCode) return c.json({ error: "user_code_required", detail: "缺少配对码（请粘贴页面显示的配对码）" }, 400);
    const grant = store.findByUserCode(userCode);
    if (!grant || Date.now() > grant.expiresAt) {
      return c.json({ error: "invalid_code", detail: "配对码不正确或已过期——请重新执行 pnpm editor login 获取新授权链接" }, 400);
    }
    if (!grant.approved || !grant.token) {
      return c.json({ error: "not_approved", detail: "请先在浏览器打开授权链接并登录（页面会显示配对码）" }, 409);
    }
    if (grant.used) {
      return c.json({ error: "already_used", detail: "配对码已使用过——请重新执行 pnpm editor login" }, 409);
    }
    store.markUsed(userCode);
    return c.json({ status: "approved", token: grant.token });
  });

  return app;
}

/** 授权页 HTML 模板（自包含，无外部依赖） */
function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · dailog 编辑授权</title><style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#fafafa;color:#1a1a1a;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px;max-width:420px;width:100%;box-sizing:border-box}
  h1{font-size:20px;margin:0 0 8px} p{color:#666;font-size:14px;margin:0 0 16px}
  input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;font-size:14px}
  button{width:100%;padding:10px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer}
  .code{font-size:40px;font-weight:700;letter-spacing:.15em;text-align:center;border:2px dashed #1a1a1a;border-radius:12px;padding:20px;margin:16px 0;user-select:all}
  .ok{color:#0a7d33;font-weight:600} .err{color:#c0392b;font-size:13px;min-height:18px;margin:8px 0 0}
  </style></head><body><div class="card">${body}</div></body></html>`;
}

export function deviceApproveRoutes(store: DeviceStore, auth: AuthLike) {
  const app = new Hono<AuthEnv>();
  app.use("/v1/device/*", requireRole("editor"));

  /** 浏览器授权确认（cookie 会话 + editor/admin 角色）：签发 bearer token 存 grant，返回配对码供页面展示 */
  app.post("/v1/device/approve", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { deviceCode?: unknown } | null;
    const deviceCode = typeof body?.deviceCode === "string" ? body.deviceCode : "";
    if (!deviceCode) return c.json({ error: "device_code_required" }, 400);
    const grant = store.get(deviceCode);
    if (!grant) return c.json({ error: "expired", detail: "授权已过期，请重新执行 pnpm editor login" }, 410);
    if (grant.approved) return c.json({ error: "already_approved", userCode: formatUserCode(grant.userCode) }, 409);

    const userId = c.get("userId");
    // cookie 会话 → bearer token（better-auth session 对象含 token 字段）
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const token = (session as unknown as { session?: { token?: string } })?.session?.token;
    if (!token) return c.json({ error: "no_session_token" }, 500);
    store.approve(deviceCode, userId, token);
    return c.json({ ok: true, userCode: formatUserCode(grant.userCode) });
  });

  return app;
}
