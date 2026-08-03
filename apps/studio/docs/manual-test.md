# 工作台 SPA 本地手测清单（计划 5 验收 + M5 认证迁移）

> **M5（2026-08-03）**：认证已切换 better-auth（自托管，bearer token 模式）。**注册开放**，邀请码（授权码）用于开通频道（管理员 CLI 生成），不再依赖 Supabase。

## 前置

```bash
# 一键启动（api 8787 + studio 5173 并行，api 自动加载 .env.local）
pnpm dev

# 或分开启动
pnpm dev:api       # 只起 api（8787）
pnpm dev:studio    # 只起 studio（5173）

# 生成授权码（注册后开通频道用；admin user 自动创建）
pnpm invite my-test-code
pnpm invite my-expiring-code --expires 30
```

`apps/studio/.env.local`：

```
VITE_API_BASE_URL=          # 空 = 同源走 vite 代理（推荐）
VITE_EXTENSION_ID=<dev 扩展 id>   # 留空则隐藏扩展连接卡
```

浏览器打开 http://localhost:5173。

## 验收路径

### 1. /auth（better-auth，注册开放）
- [ ] 未登录访问 `/dashboard` 自动跳 `/auth`
- [ ] 注册：密码 <8 位被拦截
- [ ] 注册成功（无需邀请码）→ 跳 `/onboarding/channel`（注册即登录态）
- [ ] 刷新页面会话保持（localStorage token + get-session 恢复）
- [ ] 登录成功后自动跳转（已开通频道 → onboarding/voice 或 dashboard）
- [ ] 错误密码显示服务端错误文案
- [ ] 退出登录 → 回 /auth；再访问受保护页被重定向

### 1.5 /onboarding/channel（授权码开通频道）
- [ ] 错误码 → "授权码无效或已被使用"
- [ ] 正确码 → "频道已开通 ✓" → 下一步进录音
- [ ] "稍后开通" → dashboard 显示黄色开通横幅
- [ ] 未开通时：新节目向导生成步骤被 403 挡住（引导开通）

### 2. /onboarding/voice
- [ ] 浏览器弹出麦克风授权；拒绝时显示错误
- [ ] 录音：波形动起来；计时走；30s 自动停止
- [ ] <8s 录音显示"至少 8 秒"；≥8s 可提交
- [ ] 试听/重录/丢弃正常
- [ ] 提交后"训练音色中…"；成功 → dashboard
- [ ] （依赖 Fish 额度）502 时显示降级提示但可继续

### 3. 扩展采集 → dashboard
- [ ] chrome://extensions 加载 apps/extension（dev 模式），记下扩展 id
- [ ] dashboard 点"连接扩展" → 显示"扩展已连接 ✓"（token 注入 = better-auth session token）
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

- 录音需要麦克风权限（localhost 可）；若 headless 环境跳过录音，可先用 POST /api/me/voice-sample 直传替代验证
- Fish 音色训练与生成需要 API 额度；未充值时验证到"训练失败提示"与"生成失败重试"即可
- 扩展注入的是 better-auth session token（非 JWT）——协议与 M5 前一致（Authorization: Bearer）
