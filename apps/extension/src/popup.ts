import { getToken, getApiBase, setApiBase, getLoginBase, setLoginBase } from "./background";
import { DEFAULT_API_BASE, DEFAULT_APP_BASE, DEFAULT_LOGIN_BASE } from "./env";

async function render() {
  const status = document.getElementById("status");
  if (!status) return;
  const token = await getToken();
  status.textContent = token
    ? "已连接 dailog（打开对话页点击采集）"
    : `未连接：请先登录 ${DEFAULT_APP_BASE}`;

  const input = document.getElementById("api-base") as HTMLInputElement | null;
  if (input) input.value = await getApiBase();
  const loginInput = document.getElementById("login-base") as HTMLInputElement | null;
  if (loginInput) loginInput.value = await getLoginBase();

  document.getElementById("save")?.addEventListener("click", async () => {
    if (input) {
      await setApiBase(input.value);
      input.value = await getApiBase();
    }
    if (loginInput) {
      await setLoginBase(loginInput.value);
      loginInput.value = await getLoginBase();
    }
    showHint("已保存，采集时生效");
  });

  document.getElementById("reset")?.addEventListener("click", async () => {
    if (input) {
      await setApiBase("");
      input.value = await getApiBase();
    }
    if (loginInput) {
      await setLoginBase("");
      loginInput.value = await getLoginBase();
    }
    showHint(`已恢复构建默认：API ${DEFAULT_API_BASE} / 登录页 ${DEFAULT_LOGIN_BASE}`);
  });
}

function showHint(text: string) {
  const hint = document.getElementById("hint");
  if (hint) hint.textContent = text;
}

void render();
