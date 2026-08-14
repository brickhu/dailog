# Spike: 无头浏览器 vs Cloudflare（Claude 分享页）

> 日期：2026-08-02 · 状态：**结论定稿** —— 无头浏览器方案不可行，慢路径改为浏览器扩展

## 目标

验证能否用无头浏览器获取 Claude 分享页（`claude.ai/share/{uuid}`）的对话内容，为「慢路径」架构决策提供数据。

## 方法

本地 Playwright 驱动系统已装 Chrome（`channel: "chrome"`，headless），拦截全部网络请求（request/response 事件），加载分享页并等待渲染，观察结果。

- 环境：本机（住宅 IP，经 SOCKS 代理 127.0.0.1:1081）
- Playwright Chromium CDN 直下失败（ECONNRESET），改用系统 Chrome

## 结果

| 观察项 | 结果 |
|---|---|
| 页面标题 | `Just a moment...`（Cloudflare 质询页） |
| 页面文本 | "Performing security verification ... This website uses a security service to protect against malicious bots ... Ray ID: a24d750dbf65fcfa" |
| 等待 70s | 仍未通过质询 |
| 数据接口 | `claude.ai/edge-api/bootstrap?statsig...` → **403**（CF 质询页 HTML） |
| 质询类型 | **Cloudflare Turnstile 交互式挑战**（`challenges.cloudflare.com/turnstile/v0/...`） |
| 附加请求 | `api/challenge_redirect?to=...`（307 → 403）、`cdn-cgi/challenge-platform/...` orchestrate/pat/ci 系列 |

## 关键请求日志摘录

```
REQ GET https://claude.ai/share/6cc0f373-72c5-4afd-a223-98471688e736
REQ GET https://claude.ai/edge-api/bootstrap?statsig_hashing_algorithm=...
RES 403 [text/html] https://claude.ai/edge-api/bootstrap?...   ← "Just a moment..."
REQ GET https://claude.ai/api/challenge_redirect?to=https%3A%2F%2Fclaude.ai%2Fshare%2F...
REQ GET https://challenges.cloudflare.com/turnstile/v0/g/f70cb37711aa/api.js?...
REQ POST https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/fo/...
```

## 对照实验（此前已做）

- **真实浏览器（住宅 IP）**：IAB 加载同一分享页 → **完整渲染对话**（"Shared by fei" + 全量消息，无需登录）
- **curl（浏览器头）**：API 路径全部被 CF 质询拦截
- **Anthropic 自家代码**：客户端明确检查 `cf-mitigated` 响应头——其 API 层挂在 CF 防护后

## 结论

1. **Claude 分享内容接口存在，但对非真人浏览器不可达**：Cloudflare Turnstile 交互式质询会识别无头 Chrome（`navigator.webdriver`、渲染差异等指纹），stealth 类插件不足以对抗
2. **云端无头浏览器方案（Fly 跑 Playwright）不可行**：无头特征 + 数据中心 IP 双重高危，且 Turnstile 交互式质询无可靠程序化解法
3. **慢路径定为「浏览器扩展」**：用户侧真实浏览器（住宅 IP + 真实指纹）打开分享页 → 扩展 content script 解析 DOM → 回传平台。CF 无法区分"真人用扩展浏览"与"真人浏览"，成功率接近 100%
4. 浏览器扩展同时是将来所有 CF 质询平台的通用慢路径（ChatGPT 视实测）

## 对产品设计的影响

- Claude 导入体验：一次性安装扩展 → 打开分享页自动采集（与验证码机制兼容：先发码 → 再分享 → 打开页面即采集校验）
- 排期因素：扩展需 Chrome/Edge 商店上架（审核周期数天~数周），提前规划
