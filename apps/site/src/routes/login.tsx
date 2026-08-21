import { createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { LoginForm, getLoginRedirect } from "@dailogues/auth-ui";
import { env } from "../lib/env";
import { useAuth } from "../lib/auth";
import * as stylex from "@stylexjs/stylex";
import { layouts } from "@dailogues/ui/theme.stylex";

// 全站统一登录页（dailog.fm/login）：业务配置声明——认证端点（站内代理）+ 跳转白名单。
// 页面与流程全部由共享 LoginForm 提供。
// 登录成功用 router 内导航（不整页刷新）：整页刷新会重拉全部资源，部署切换/缓存不一致时
// 可能拿到引用已删除旧哈希的坏壳 → iOS 页面卡死复现；SPA 导航则只请求目标页数据。
// Header 等全局组件不随路由重挂载，登录态由 AuthProvider（lib/auth.ts）管理——
// onSuccess 里 refresh() 后 Header 响应式更新。
export default function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
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
          navigate(
            getLoginRedirect({
              allowedOrigins: [env.siteBaseUrl],
              fallback: "/settings",
            }),
          );
          return;
        }
      }
    } finally {
      setChecking(false); // 未登录（或查询失败）：展示登录表单
    }
  });

  return (
    <div {...stylex.props(layouts.page)}>
      <div {...stylex.props(layouts.containerSm)}>
      <div {...stylex.props(layouts.fullRow)}>
      <LoginForm
        checkingSession={checking()}
        config={{
          loginOrOtpEndpoint: "/v1/auth/login-or-otp",
          otpCompleteEndpoint: "/v1/auth/otp-complete",
          forgotPasswordUrl: "/forgot-password",
        }}
        redirect={{ allowedOrigins: [env.siteBaseUrl] }}
        // SPA 内导航（替代 window.location.href 整页刷新）
        navigate={navigate}
        onSuccess={() => {
          // 登录成功：AuthProvider 重新拉取用户态（Header 等消费方响应式自动更新；
          // SPA 导航不重挂载全局组件，必须刷新 context 状态）
          void refresh();
        }}
      />
      </div>
    </div>
      </div>
  );
}
