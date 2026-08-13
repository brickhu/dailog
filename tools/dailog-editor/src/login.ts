// 配对码登录（Slack 式）——密码不落盘、不经 CLI：
//   1. 创建授权 → 打印浏览器授权 URL（自动尝试打开）
//   2. 编辑在浏览器打开链接 → 登录（已登录略过）→ 页面显示【配对码】
//   3. 把配对码粘贴回本终端 → 提交配对 → bearer token 写入
//      .dailog-editor/session.json（chmod 600）→ 当前对话上下文保持登录
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import type { EditorConfig } from "./lib.js";
import { apiFetch, clearSession, hasValidSession, saveSession } from "./lib.js";

/** macOS/Linux 下尝试自动打开浏览器；失败静默（用户手动打开） */
function tryOpen(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (cmd) execFile(cmd, [url], () => {});
}

/** 等待用户在终端粘贴配对码（回车提交；Ctrl+C 退出） */
function promptPairCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question("配对码 > ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
    rl.on("SIGINT", () => {
      rl.close();
      reject(new Error("已取消"));
    });
  });
}

export async function login(config: EditorConfig, args: string[]): Promise<void> {
  if (args.includes("--logout")) {
    clearSession();
    console.log("[auth] 已清除本地登录态");
    return;
  }
  if (args.includes("--force")) clearSession();
  if (hasValidSession(config)) {
    console.log(`[auth] 当前环境（${config.envName ?? config.apiBase}）已有有效登录态。如需重新配对：pnpm editor login --force`);
    return;
  }

  // 1. 创建授权（拿 deviceCode；授权链接由 API 域内自包含页面完成——不依赖 site）
  const res = await apiFetch(`${config.apiBase}/v1/device`, { method: "POST" });
  if (!res.ok) {
    console.error(`[auth] 创建授权失败（${res.status}）: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const { deviceCode } = (await res.json()) as { deviceCode: string };
  const verificationUrl = `${config.apiBase.replace(/\/$/, "")}/v1/device/authorize?code=${deviceCode}`;

  // 2. 提示浏览器授权（页面会显示配对码）
  console.log("① 在浏览器打开以下链接并登录授权（需 editor/admin 角色；已登录则直接授权）：\n");
  console.log(`  ${verificationUrl}\n`);
  tryOpen(verificationUrl);
  console.log("② 页面会显示一个【配对码】——复制它，粘贴到下面（5 分钟内有效）：");

  // 3. 等用户粘贴配对码 → 提交换取 token
  const userCode = await promptPairCode().catch(() => {
    console.error("\n[auth] 已取消");
    process.exit(1);
  });
  if (!userCode) {
    console.error("[auth] 配对码不能为空");
    process.exit(1);
  }
  const pairRes = await apiFetch(`${config.apiBase}/v1/device/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userCode }),
  });
  const data = (await pairRes.json().catch(() => null)) as { status?: string; token?: string; error?: string; detail?: string } | null;
  if (!pairRes.ok) {
    console.error(`[auth] 配对失败：${data?.detail ?? data?.error ?? `HTTP ${pairRes.status}`}`);
    if (pairRes.status === 409) {
      console.error("[auth] 请确认已在浏览器完成授权（打开授权链接并登录），然后重新执行 pnpm editor login");
    }
    process.exit(1);
  }
  if (data?.status !== "approved" || !data.token) {
    console.error("[auth] 配对响应异常（缺少 token），请重新执行 pnpm editor login");
    process.exit(1);
  }

  // 4. 写入本地会话（绑定当前环境）——当前对话上下文保持登录
  saveSession(data.token, config.apiBase);
  console.log(`[auth] ✅ 配对成功（环境 ${config.envName ?? config.apiBase}）——可以直接执行编辑命令了`);
}
