# 工作台 SPA 本地手测清单（五层模型：快照 → 容器 → 脚本 → 节目 → 音轨）

> **2026-08**：采集统一走分享链接服务（importer.dailog.fm）——粘贴分享链接 → 快照缓存 → 质量分析 → 创建创作容器 → 润色生成脚本 → 生成节目 → 发布。扩展采集已停用（源码保留）。

## 前置

```bash
# 一键启动三端（importer 8798 + api 8787 + studio 5173 并行）
pnpm dev

# 本地数据库（docker）：首次需迁移
docker run -d --name dailog-pg -e POSTGRES_USER=dailogues -e POSTGRES_PASSWORD=dailogues -e POSTGRES_DB=dailogues -p 5432:5432 postgres:16-alpine
cd services/api && pnpm db:migrate

# 生成授权码（注册后开通频道用）
pnpm invite my-test-code
```

`services/api/.env.local`：`IMPORTER_URL=http://localhost:8798`（本地 importer）
`services/importer/.env.local`：`PORT=8798`、`IMPORTER_TOKEN`、`SCRAPERAPI_KEY`

浏览器打开 http://localhost:5173。

## 验收路径

### 1. 登录/注册（注册开放）
- [ ] 未登录访问自动跳登录
- [ ] 注册成功（无需邀请码）→ 开通频道（授权码）→ 录音

### 2. 导入（首页 /，粘贴分享链接）
- [ ] 输入非法链接 → 红色提示"不是有效的分享页链接"，采集按钮禁用（前端预检，规则来自 importer /platforms）
- [ ] 输入合法链接（如 `https://claude.ai/share/<uuid>`）→ 绿色"✓ 检测到 Claude 分享链接"
- [ ] 点击采集 → 预览：标题/平台/消息数/消息全文
- [ ] 质量检测显示：通过（含语言）或 ⚠️ 未通过 + 原因（仍可继续）
- [ ] 确认创建 → 跳转 `/polish/:id` 编辑页
- [ ] **重复粘贴同一链接** → 直接跳已有 `/polish/:id`（不重复采集——快照缓存 + existing 跳转）
- [ ] 失效链接（不存在的分享 id）→ "该分享链接已失效或被取消"

### 3. /polish/:id 编辑页（创作容器）
- [ ] 标题/来源链接显示；质量未通过时顶部黄色提示
- [ ] 无脚本时显示"还没有脚本"空态
- [ ] 点击「生成新脚本」→ SSE 润色流式浮现（段落逐条出现）→ 完成出现在脚本列表
- [ ] 再次生成 → 第二条 transcript（列表多条，可切换选择）
- [ ] 脚本编辑：切换发言者/上移下移/删除/改文本 → 保存
- [ ] 润色上限：free 5 条 → 429 提示
- [ ] 选定脚本 → 「用当前脚本生成节目」→ 进度条阶段流转（排队→合成→拼接→上传）
- [ ] 生成完成 → 试听 → 标题输入 → 发布 → "节目已发布 ✓"
- [ ] 工作台 `/episodes` 列表显示已发布节目

### 4. /app/settings
- [ ] 当前样本状态展示；重录 → 保存新声音生效
- [ ] 404 页：随便输个路径

## 已知依赖

- 录音需要麦克风权限（localhost 可）；若 headless 环境跳过录音，可先用 POST /api/me/voice-sample 直传替代验证
- Fish 音色训练与生成需要 API 额度；未充值时验证到"训练失败提示"与"生成失败重试"即可
- 采集依赖 ScraperAPI 额度（claude/doubao 等被 CF/海外限制平台）；免费 1000 次/月
- importer 解码失败（内容为空）**不写快照**——平台结构变化时每次重试，修复后自动恢复

---

## 消费站 + SSO 验证链（apps/site）

### 前置
```bash
pnpm dev                  # api + studio
cd apps/site && pnpm dev  # 消费站（3000，.env.local 已配 DATABASE_URL）
```

### 验证链
- [ ] `localhost:3000` 首页显示已发布节目（最新列表）
- [ ] `localhost:3000/@fixture-channel` 频道页（简介 + 列表 + RSS 链接）
- [ ] `localhost:3000/episode/:id` 单集页（播放器 + 点赞/收藏按钮）
- [ ] **SSO**：`localhost:3000/login` 登录 → 跳回 → `localhost:5173` 刷新即已登录
- [ ] 单集页收藏 → `localhost:3000/me` 可见；未登录点收藏 → 跳 `/login?redirect=...`
