import { getToken, getApiBase, setApiBase } from "./background";
import { DEFAULT_API_BASE, DEFAULT_APP_BASE } from "./env";

async function render() {
  const status = document.getElementById("status");
  if (!status) return;
  const token = await getToken();
  status.textContent = token
    ? "已连接 dailogues（打开对话页点击采集）"
    : `未连接：请先登录 ${DEFAULT_APP_BASE}`;

  const input = document.getElementById("api-base") as HTMLInputElement | null;
  if (input) input.value = await getApiBase();

  document.getElementById("save")?.addEventListener("click", async () => {
    if (!input) return;
    await setApiBase(input.value);
    input.value = await getApiBase();
    showHint("已保存，采集时生效");
  });

  document.getElementById("reset")?.addEventListener("click", async () => {
    if (!input) return;
    await setApiBase("");
    input.value = await getApiBase();
    showHint(`已恢复构建默认：${DEFAULT_API_BASE}`);
  });
}

function showHint(text: string) {
  const hint = document.getElementById("hint");
  if (hint) hint.textContent = text;
}

void render();
