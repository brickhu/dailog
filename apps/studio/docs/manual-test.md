# 工作台 SPA 本地手测清单（计划 5 验收）

> **⚠️ 架构变更（2026-08-03 决策）**：认证方案由 Supabase Auth 改为 **better-auth**（自托管，与后端同库 Railway Postgres）。本清单中基于 supabase-js 的登录/注册步骤与 `VITE_SUPABASE_*` 配置将在 **M5 迁移任务**中切换到 better-auth（`/api/auth/*` + email+password + 同库用户表）；届时更新本文件对应条目。

## 前置

```bash
# 终端 1：api（8787，需 .env.local 含 APP_ORIGINS=http://localhost:5173）
cd services/api && set -a && source .env.local && set +a && npx tsx src/index.ts

# 终端 2：studio（5173）
cd apps/studio && pnpm dev
```

`apps/studio/.env.local`：

```
VITE_SUPABASE_URL=<云端 supabase url>
VITE_SUPABASE_ANON_KEY=<anon public key>
VITE_API_BASE_URL=          # 空 = 同源走 vite 代理（推荐）
VITE_EXTENSION_ID=<dev 扩展 id>   # 留空则隐藏扩展连接卡
```

浏览器打开 http://localhost:5173。

## 验收路径

### 1. /auth
- [ ] 未登录访问 `/dashboard` 自动跳 `/auth`
- [ ] 注册：邀请码为空被拦截（"请填写邀请码"）；密码 <8 位被拦截
- [ ] 注册成功 → 跳 `/onboarding/voice`（Supabase 开邮箱确认时显示"查收确认邮件"）
- [ ] 登录成功后自动跳转（有样本 → dashboard；无样本 → onboarding）
- [ ] 错误密码显示服务端错误文案

### 2. /onboarding/voice
- [ ] 浏览器弹出麦克风授权；拒绝时显示错误
- [ ] 录音：波形动起来；计时走；30s 自动停止
- [ ] <8s 录音显示"至少 8 秒"；≥8s 可提交
- [ ] 试听/重录/丢弃正常
- [ ] 提交后"训练音色中…"；成功 → dashboard
- [ ] （依赖 Fish 额度）502 时显示降级提示但可继续

### 3. 扩展采集 → dashboard
- [ ] chrome://extensions 加载 apps/extension（dev 模式），记下扩展 id
- [ ] dashboard 点"连接扩展" → 显示"扩展已连接 ✓"
- [ ] 打开 DeepSeek/Claude 对话页 → 点扩展采集 → 提示成功
- [ ] 回到 dashboard（刷新）→ 出现新草稿（平台徽标正确）
- [ ] 空列表时显示引导文案；"开始新节目"进入向导

### 4. /episodes/new 向导
- [ ] ① 列表显示已采集对话（标题/平台/日期）→ 选择进入 ②
- [ ] ② 无脚本：自动触发润色，SSE 段落逐渐浮现 → 完成
- [ ] ② 有脚本：直接进入编辑态（版本号正确）
- [ ] ② 编辑：切换发言者（你/AI）、上移/下移/删除/添加段落、改文本
- [ ] ② 保存草稿 → toast"草稿已保存"；刷新后内容还在
- [ ] ② 低质量对话：422 reason 展示 + 可返回 ①
- [ ] ③ 点击"开始生成" → 进度条阶段流转（排队→合成→拼接→上传）
- [ ] ③ 完成后试听播放（真实音频）
- [ ] ③ 403（额度用完）→ 购买引导文案
- [ ] ④ 标题预填、可改描述 → 发布 → 成功态
- [ ] 刷新 dashboard → 该节目显示"已发布"

### 5. /settings
- [ ] 当前样本状态展示；重录 → 保存新声音生效
- [ ] 邀请码/订阅占位文案显示
- [ ] 退出登录 → 回 /auth
- [ ] 404 页：随便输个路径

## 已知依赖

- 真实登录需要 Supabase anon key（VITE_SUPABASE_ANON_KEY）
- 录音需要麦克风权限（localhost 可）；若 headless 环境跳过录音，可先用 POST /api/me/voice-sample 直传替代验证
- Fish 音色训练与生成需要 API 额度（当前 402）；未充值时验证到"训练失败提示"与"生成失败重试"即可
