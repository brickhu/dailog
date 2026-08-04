import { onMount } from "solid-js";
import { LoginForm, getLoginRedirect } from "@dailogues/auth-ui";
import { env } from "../lib/env";

// 全站统一登录页（dailogues.com/login）：业务配置声明——认证端点（站内代理）+ 跳转白名单。
// 页面与流程全部由共享 LoginForm 提供。
export default function LoginPage() {
  // 已登录访问登录页 → 统一回跳（client 判定，SSR 首帧不跳）：
  // 来源路径（?redirect= 白名单内）或根路径——与登录成功后的跳转同一套共享逻辑
  onMount(async () => {
    const res = await fetch("/api/auth/get-session");
    if (!res.ok) return;
    // better-auth 未登录返回 JSON null——必须整体可选链
    const data = (await res.json()) as { user?: unknown } | null;
    if (!data?.user) return;
    window.location.href = getLoginRedirect({
      allowedOrigins: [env.siteBaseUrl, env.studioBaseUrl],
      fallback: "/",
    });
  });

  return (
    <LoginForm
      config={{
        signInEndpoint: "/api/auth/sign-in/email",
        signUpEndpoint: "/api/auth/sign-up/email",
        verification: {
          // 重发验证邮件走站内代理（与注册同链路：api 发信 + Set-Cookie 透传）
          resendEndpoint: "/api/auth/send-verification-email",
          // 验证链接点击后跳回站点首页
          callbackURL: env.siteBaseUrl,
        },
      }}
      redirect={{ allowedOrigins: [env.siteBaseUrl, env.studioBaseUrl] }}
    />
  );
}
