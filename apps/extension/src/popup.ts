import { getToken } from "./background";

async function render() {
  const status = document.getElementById("status");
  if (!status) return;
  const token = await getToken();
  status.textContent = token ? "已连接 dailogues（打开对话页点击采集）" : "未连接：请先登录 app.dailogues.com";
}

void render();
