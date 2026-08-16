#!/usr/bin/env node
// API dev 自愈守护（本地直跑与 docker 容器共用）：
// tsx watch / node --watch 在应用崩溃后都只是等待文件变化、不会自动重启——
// 编辑代码时一次瞬时编译错误（如文件写入中间态）就能让 8787 静默死掉，直到手动 docker restart。
// 本守护进程替代 tsx watch：① 文件变化 → 重启 ② 应用崩溃 → 1s 后自动重启，
// 崩溃时若文件已修好则立即恢复，dev 环境不再需要手动干预。
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url))); // services/api
const nodeArgs = ["--env-file-if-exists=.env.local", resolve(apiDir, "node_modules/tsx/dist/cli.mjs"), "src/index.ts"];

let child = null;
let restarting = false; // 主动重启（文件变化触发）——exit 后直接拉起
let reloadTimer = null;

function stopChild() {
  if (!child) return;
  child.kill("SIGTERM");
  const killer = setTimeout(() => child?.kill("SIGKILL"), 5000); // 优雅退出超时兜底
  child.once("exit", () => clearTimeout(killer));
}

function start() {
  child = spawn(process.execPath, nodeArgs, { cwd: apiDir, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    child = null;
    if (restarting) {
      restarting = false;
      start();
      return;
    }
    console.log(`[dev-supervisor] 进程退出（code=${code} signal=${signal}）→ 1s 后自动重启`);
    setTimeout(start, 1000);
  });
}

/** 文件变化（200ms 合并抖动）→ 重启应用 */
function scheduleReload() {
  if (reloadTimer) return;
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    if (!child) return;
    console.log("[dev-supervisor] 检测到文件变化 → 重启");
    restarting = true;
    stopChild();
  }, 200);
}

watch(resolve(apiDir, "src"), { recursive: true }, scheduleReload);

// 容器 stop / Ctrl+C：转发信号让子进程优雅退出（守护为 PID 1 时直接收 SIGTERM）
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    console.log(`[dev-supervisor] 收到 ${sig} → 退出`);
    stopChild();
    setTimeout(() => process.exit(0), 300);
  });
}

start();
