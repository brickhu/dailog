// 环境状态检查（会话初始化用）：① 先 /health 检查端点可用性 → ② 再检查配对/授权有效性
// 新对话开始先跑这个：端点不可达 → 换环境/查网络；未配对 → 引导 login
import type { EditorConfig } from "./lib.js";
import { apiFetch, listEnvironments } from "./lib.js";
import { getToken, hasValidSession } from "./session.js";

export async function authStatus(config: EditorConfig, _args: string[]): Promise<void> {
  console.log(`[env] 环境：${config.envName ?? "（默认）"} → ${config.apiBase}`);

  // 列出全部可用环境（会话初始化时供用户选择）
  const envs = listEnvironments();
  if (envs.length > 0) {
    console.log(`[env] 可用环境：${envs.map((e) => `${e.name}${e.label ? `（${e.label}）` : ""}`).join(" / ")}`);
  }

  // ① 端点可用性（无鉴权 /health；区分「环境不可达」与「未授权」）
  let healthOk = false;
  try {
    const res = await apiFetch(`${config.apiBase}/health`, { signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      console.log(`[env] ✅ 端点可用（/health ${res.status}）`);
      healthOk = true;
    } else {
      console.log(`[env] ⚠️ 端点异常（/health HTTP ${res.status}）——确认 API 地址与环境`);
    }
  } catch {
    console.log("[env] ❌ 端点不可达（连接失败/超时）——确认 API 地址与网络");
  }
  if (!healthOk) process.exit(1);

  // ② 配对/授权有效性
  if (!hasValidSession(config.apiBase)) {
    console.log("[auth] 未配对——执行配对码登录：pnpm editor login" + (config.envName ? ` --env ${config.envName}` : ""));
    process.exit(1);
  }
  try {
    const res = await apiFetch(`${config.apiBase}/v1/me/profile`, {
      headers: { Authorization: `Bearer ${getToken(config.apiBase)}` },
    });
    if (res.status === 401) {
      console.log("[auth] ❌ 本地 token 已失效——请重新配对：pnpm editor login" + (config.envName ? ` --env ${config.envName}` : ""));
      process.exit(1);
    }
    if (!res.ok) {
      console.log(`[auth] ⚠️ 授权检查异常（HTTP ${res.status}）`);
      process.exit(1);
    }
    const profile = (await res.json().catch(() => null)) as { email?: string | null; username?: string | null } | null;
    console.log(`[auth] ✅ 授权有效：${profile?.email ?? profile?.username ?? "编辑账号"}`);
  } catch {
    console.log("[auth] ⚠️ 授权检查请求失败，请重试");
    process.exit(1);
  }
}
