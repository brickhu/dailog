import { mount, StartClient } from "@solidjs/start/client";

const root = document.getElementById("app");
if (!root) throw new Error("root #app not found");
mount(() => <StartClient />, root);

// dev 消除 FOUC（见 entry-server 的 stylex-pre）：head 中 stylex runtime 脚本（module，
// deferred）先于本模块执行——执行到这里时样式已注入完成，移除隐藏类显示页面。
// 下一帧再移除：确保首帧绘制拿到完整样式（避免移除后立即重绘露出无样式帧）。
if (import.meta.env.DEV) {
  requestAnimationFrame(() => {
    document.documentElement.classList.remove("stylex-pre");
  });
}
