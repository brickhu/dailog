import { onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";

// 旧路径 /account → /settings（页面级重定向；不用 GET handler——API 路由会吞掉
// 同段静态路径，历史上导致 /discover 等页面 503）
export default function LegacyAccountRedirect() {
  const navigate = useNavigate();
  onMount(() => navigate("/settings", { replace: true }));
  return null;
}
