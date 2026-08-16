import { Navigate, useSearchParams } from "@solidjs/router";
import SubmitPage from "./submit";

// /import = 导入第二步（确认投稿/配置主持人）：不展示 URL 输入步骤——
// URL 由导入弹框（ImportDialog）输入并检测后带 ?url= 跳转而来；
// 直接访问且无 url 参数 → 重定向 /submit（完整投稿流程入口）
export default function ImportPage() {
  const [params] = useSearchParams<{ url?: string }>();
  const url = params.url;
  if (!url || !url.startsWith("http")) {
    return <Navigate href="/submit" />;
  }
  // ?url= 预填 → SubmitPage 自动跳过 input 步骤直接进入 confirm
  return <SubmitPage />;
}
