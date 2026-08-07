// 扩展配置页（manifest options_page；chrome://extensions → 扩展程序选项）。
// 编辑运行时配置（存 chrome.storage），保存即生效——不用改文件、不用重载扩展。

import { getAppBase, getRuntimeConfig, setRuntimeConfig } from "./background";
import { DEFAULT_APP_BASE } from "./env";

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function init(): Promise<void> {
  const input = $("app-base") as HTMLInputElement | null;
  const hint = $("hint");
  if (!input || !hint) return;

  // 输入框展示当前覆盖值（未设置 = 空）；hint 展示生效值
  const cfg = await getRuntimeConfig();
  input.value = cfg.appBase ?? "";
  hint.textContent = `当前生效：${await getAppBase()}（构建默认 ${DEFAULT_APP_BASE}）`;

  $("save")?.addEventListener("click", async () => {
    const value = input.value.trim();
    await setRuntimeConfig({ appBase: value });
    hint.textContent = value
      ? `已保存：${value}（生效）`
      : `已保存（恢复构建默认 ${DEFAULT_APP_BASE}）`;
  });
  $("clear")?.addEventListener("click", async () => {
    await setRuntimeConfig({});
    input.value = "";
    hint.textContent = `已清除，生效：${DEFAULT_APP_BASE}`;
  });
}

init();
