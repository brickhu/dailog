// 配对码登录（Slack 式）——密码不落盘、不经 CLI：
//   1. 创建授权 → 打印浏览器授权 URL（自动尝试打开）
//   2. 编辑在浏览器打开链接 → 登录（已登录略过）→ 页面显示【配对码】
//   3. 把配对码粘贴回终端/对话 → 提交配对 → bearer token 写入
//      .dailog-editor/session.json（chmod 600）→ 当前对话上下文保持登录
//
// 两种交接方式：
//   · 交互式终端（stdin 是 TTY）：默认走 readline，阻塞等用户粘贴配对码。
//   · 非交互 harness（stdin 不是 TTY，agent 后台跑）：不阻塞、绝不自行抓验证码——
//     创建授权后打印 URL 并退出，提示把配对码贴回对话后重跑 `login --code <码>` 完成配对。
//     已创建的授权缓存在 pending-device.json，`--code` 复用同一授权（避免用户重开/重授权）。
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import type { EditorConfig } from "./lib.js";
import { apiFetch, clearSession, hasValidSession, saveSession, pendingDevicePath } from "./lib.js";

/** 待配对授权缓存：记录已创建的 deviceCode（供 `--code` 复用同一授权）；与登录态一样绑定环境 */
interface PendingDevice {
  apiBase: string;
  deviceCode: string;
  verificationUrl: string;
  createdAt: string;
}

function readPendingDevice(config: EditorConfig): PendingDevice | null {
  try {
    const p = pendingDevicePath();
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, "utf-8")) as PendingDevice;
    return d?.apiBase === config.apiBase ? d : null;
  } catch {
    return null;
  }
}

function writePendingDevice(config: EditorConfig, d: PendingDevice): void {
  try { writeFileSync(pendingDevicePath(), JSON.stringify(d), { mode: 0o600 }); } catch { /* 缓存失败不阻塞 */ }
}

function clearPendingDevice(): void {
  try { unlinkSync(pendingDevicePath()); } catch { /* 无文件 */ }
}

/** macOS/Linux 下尝试自动打开浏览器；失败静默（用户手动打开） */
function tryOpen(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (cmd) execFile(cmd, [url], () => {});
}

/** 交互式终端下等待用户粘贴配对码（回车提交；Ctrl+C 退出） */
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

/** 创建授权（拿 deviceCode 与授权 URL；授权链接由 API 域内自包含页面完成——不依赖 site） */
async function createDevice(config: EditorConfig): Promise<{ deviceCode: string; verificationUrl: string }> {
  const res = await apiFetch(`${config.apiBase}/v1/device`, { method: "POST" });
  if (!res.ok) {
    console.error(`[auth] 创建授权失败（${res.status}）: ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const { deviceCode } = (await res.json()) as { deviceCode: string };
  const verificationUrl = `${config.apiBase.replace(/\/$/, "")}/v1/device/authorize?code=${deviceCode}`;
  return { deviceCode, verificationUrl };
}

/** 提交配对码 → 换取 token；成功落盘，失败退出 */
async function submitPair(config: EditorConfig, userCode: string): Promise<void> {
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
  clearPendingDevice();
  saveSession(data.token, config.apiBase);
  console.log(`[auth] ✅ 配对成功（环境 ${config.envName ?? config.apiBase}）——可以直接执行编辑命令了`);
}

/** 解析 --code <配对码>（带值参数；可出现在任何位置） */
function parseCodeOption(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--code" || args[i] === "-c") && args[i + 1]) return args[i + 1];
    if (args[i] && args[i].startsWith("--code=")) return args[i].slice("--code=".length);
  }
  return null;
}

/** 打印授权提示（打开浏览器 + 引导获取配对码） */
function printAuthGuide(config: EditorConfig, verificationUrl: string): void {
  console.log("① 在浏览器打开以下链接并登录授权（需 editor/admin 角色；已登录则直接授权）：\n");
  console.log(`  ${verificationUrl}\n`);
}

export async function login(config: EditorConfig, args: string[]): Promise<void> {
  if (args.includes("--logout")) {
    clearSession();
    clearPendingDevice();
    console.log("[auth] 已清除本地登录态");
    return;
  }
  if (args.includes("--force")) {
    clearSession();
    clearPendingDevice();
  }
  if (hasValidSession(config)) {
    console.log(`[auth] 当前环境（${config.envName ?? config.apiBase}）已有有效登录态。如需重新配对：pnpm editor login --force`);
    return;
  }

  const explicitCode = parseCodeOption(args);

  if (explicitCode) {
    // --code 路径（非交互 harness 提交阶段）：优先复用同一 pending 授权，无需用户再开浏览器
    const pending = readPendingDevice(config);
    if (pending) {
      console.log("[auth] 复用已创建的授权完成配对……");
    } else {
      // 无 pending（直接 --code 或授权过期）→ 新建授权并提示用户打开
      const dev = await createDevice(config);
      writePendingDevice(config, { ...dev, apiBase: config.apiBase, createdAt: new Date().toISOString() });
      printAuthGuide(config, dev.verificationUrl);
      tryOpen(dev.verificationUrl);
    }
    await submitPair(config, explicitCode);
    return;
  }

  const interactive = !!process.stdin.isTTY;

  if (!interactive) {
    // 非交互 harness：只创建授权 + 打印 URL，绝不阻塞、绝不自行抓验证码——
    // 停在这里等用户在浏览器拿配对码后贴回对话，再由 agent 重跑 `login --code <码>`。
    const dev = await createDevice(config);
    writePendingDevice(config, { ...dev, apiBase: config.apiBase, createdAt: new Date().toISOString() });
    printAuthGuide(config, dev.verificationUrl);
    tryOpen(dev.verificationUrl);
    console.log("② 页面会显示一个【配对码】——请把它粘贴回对话；");
    console.log(`   然后执行：pnpm editor login ${config.envName ? `--env ${config.envName} ` : ""}--code <配对码> 完成配对（5 分钟内有效）`);
    console.log("[auth] 已创建授权，等待编辑粘贴配对码。本命令不会自行获取验证码。");
    return;
  }

  // 交互式终端：创建授权 → 打印 URL → readline 阻塞等用户粘贴
  const dev = await createDevice(config);
  writePendingDevice(config, { ...dev, apiBase: config.apiBase, createdAt: new Date().toISOString() });
  printAuthGuide(config, dev.verificationUrl);
  tryOpen(dev.verificationUrl);
  console.log("② 页面会显示一个【配对码】——复制它，粘贴到下面（5 分钟内有效）：");

  const userCode = await promptPairCode().catch(() => {
    console.error("\n[auth] 已取消");
    process.exit(1);
  });
  clearPendingDevice();
  await submitPair(config, userCode);
}
