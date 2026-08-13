import { createSignal, onMount } from "solid-js";
import { LoginForm, getLoginRedirect } from "@dailogues/auth-ui";
import { env } from "../lib/env";

// 全站统一登录页（dailog.fm/login）：业务配置声明——认证端点（站内代理）+ 跳转白名单。
// 页面与流程全部由共享 LoginForm 提供。
export default function LoginPage() {
  // session 确认中：get-session 未返回前显示 loading（防已登录用户看到登录表单闪烁）
  const [checking, setChecking] = createSignal(true);

  // 已登录访问登录页 → 统一回跳（client 判定，SSR 首帧不跳）：
  // 来源路径（?redirect= 白名单内）或账号页——与登录成功后的跳转同一套共享逻辑
  onMount(async () => {
    try {
      const res = await fetch("/v1/auth/get-session");
      if (res.ok) {
        // better-auth 未登录返回 JSON null——必须整体可选链
        const data = (await res.json()) as { user?: unknown } | null;
        if (data?.user) {
          window.location.href = getLoginRedirect({
            allowedOrigins: [env.siteBaseUrl],
            fallback: "/account",
          });
          return;
        }
      }
    } finally {
      setChecking(false); // 未登录（或查询失败）：展示登录表单
    }
  });

  return (
    <LoginForm
      checkingSession={checking()}
      config={{
        loginOrOtpEndpoint: "/v1/auth/login-or-otp",
        otpCompleteEndpoint: "/v1/auth/otp-complete",
        forgotPasswordUrl: "/forgot-password",
      }}
      redirect={{ allowedOrigins: [env.siteBaseUrl] }}
    />
  );
}
