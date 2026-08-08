// Bright Data Web Unlocker 通道：按成功请求计费（免费额度 5000/月），
// 专治 Cloudflare/Turnstile 挑战。数据中心 IP 直连被 claude.ai 拦时的
// 主要兜底（claude/doubao 共用）。
// 配置：BRIGHTDATA_TOKEN（Railway service 环境变量）

import { request } from "undici";

export interface UnlockerResult {
  status: number;
  body: string;
}

/** 经 Web Unlocker 抓取目标 URL。响应体为 HTML/JSON 原文（unlocker 已过挑战）。
 *  单次请求较慢（内部等解锁流程）——超时放宽到 60s */
export async function fetchViaBrightdata(
  targetUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<UnlockerResult> {
  const token = process.env.BRIGHTDATA_TOKEN;
  if (!token) throw new Error("BRIGHTDATA_TOKEN 未配置");
  const timeoutMs = opts.timeoutMs ?? 60000;
  let res;
  try {
    res = await request("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: targetUrl }),
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
  } catch (e) {
    throw new Error(`brightdata 网络错误: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.body.text().catch(() => "");
  if (res.statusCode !== 200) {
    throw new Error(`brightdata HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`brightdata 响应非 JSON: ${text.slice(0, 200)}`);
  }
  return { status: j.status_code ?? 0, body: typeof j.body === "string" ? j.body : "" };
}
