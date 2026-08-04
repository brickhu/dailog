import type { Env } from "../config/env";

// Resend 事务邮件（邮箱验证/密码重置）：纯 fetch 调用，无额外依赖。
// 免费 3000 封/月，超出自动按量计费（pay-as-you-go，无需提前升级）。

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/** 发送邮件；RESEND_API_KEY 未配置时静默跳过（本地 dev 无 key 不阻塞流程，调用方按需提示） */
export async function sendEmail(env: Env, input: SendEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`resend 发送失败（${res.status}）: ${body.slice(0, 200)}`);
  }
}
