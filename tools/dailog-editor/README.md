# dailog-editor 子工程（tools/dailog-editor）

dailog 编辑本地 Agent 的**源码工程**：投稿（URL + 采样）→ 本地制作 → 一次性上传发布。
所有生成在编辑本地完成（拉取网页 / 脚本 / TTS / 合成 / 封面），服务端只收投稿、存成品、发通知。

## 工程结构

```
tools/dailog-editor/
├── src/           # CLI 源码（run/lib/list/detail/fetch/rule-test/console-script/paste/tts/merge/cover/publish/reject/login/auth-status）
├── skill/         # SKILL.md 源文档（ZCode 技能）
├── templates/     # 配置模板（envs.example.json / env.example）
├── build.mjs      # 构建：编译 src → 产物 scripts/，复制 SKILL/模板
└── package.json   # @dailogues/dailog-editor（esbuild / typescript / @msgpack/msgpack）
```

## 构建与产物

```bash
pnpm --filter @dailogues/dailog-editor build
```

产物 → **`.agents/skills/dailog-editor/`**（gitignored，构建生成）：

```
.agents/skills/dailog-editor/
├── SKILL.md            # skill 文档（ZCode 加载）
├── scripts/*.js        # 编译后的 CLI（ESM；@msgpack/msgpack 从仓库根 node_modules 解析）
├── envs.example.json   # 环境清单模板
└── env.example         # .dailog-editor/.env 模板
```

- 根命令 `pnpm editor <cmd>` → `node .agents/skills/dailog-editor/scripts/run.js <cmd>`
- 改源码后需重新 build 才会体现在产物；产物勿手改

## 使用（编辑机器）

### 配置（db-ops 风格）

```bash
# 1. 密钥（环境无关）：复制模板并填写 Fish/Pexels key
cp .agents/skills/dailog-editor/env.example .dailog-editor/.env
cp .dailog-editor/.env.example .dailog-editor/.env
chmod 600 .dailog-editor/.env

# 2. 环境清单（可多环境）：复制模板并按需增删
cp .agents/skills/dailog-editor/envs.example.json .dailog-editor/envs.json
#    编辑 .dailog-editor/envs.json：local / dev / prod 各自的 apiBase

# 3. 配对登录（绑定所选环境）
pnpm editor --env local login
```

**环境是会话级选择**（不落全局配置）：每次命令用 `--env <名>` 显式指定
（或 `DAILOG_ENV=<名>` 环境变量 / `--api-base <url>` 临时直连）。未指定且存在多个环境时
命令会明确列出环境清单要求选择——**避免「以为是 dev 实际打到 prod」的误操作**。

- 密钥（Fish/Pexels）只放 `.dailog-editor/.env`（gitignored）；**账号密码不落盘**——
  `pnpm editor login` 走**配对码模式**：授权链接指向 API 域内自包含授权页
  （`{apiBase}/v1/device/authorize`，不依赖 site）→ 浏览器打开登录（已登录略过）
  → 页面显示配对码 → 复制回终端粘贴 → 配对成功，token **绑定环境**缓存到
  `.dailog-editor/session.json`（chmod 600，gitignored）；跨环境 token 不通用
  （token 属于 dev 时操作 prod 会提示先配对 prod）
- 草稿（脚本/分段音频/合成件/封面）在 `.dailog-editor/drafts/{submissionId}/`（gitignored）；
  **发布成功后自动清理语音/封面**（终态——音频与图片不留本地，对话/脚本文本保留）

## 命令

```bash
pnpm editor --env <环境名> auth-status            # 会话初始化：环境授权状态（有效/失效/未配对）
pnpm editor --env <环境名> login [--force] [--logout]  # 配对码登录 / 重登 / 登出
pnpm editor --env <环境名> list                   # 待审队列（先到先审）
pnpm editor --env <环境名> detail <submissionId>  # 投稿详情（URL/投稿人/采样 transcript）
pnpm editor --env <环境名> fetch <submissionId>     # 采集 + 内容解码（URL → page.html/page.txt/dialogue.json）
#   解码规则在 .dailog-editor/rules.json（本地自进化：首次从种子初始化，命中自动统计，新平台直接更新即生效）

# ① 本地拉取网页内容（Agent 浏览器/WebFetch）→ 提取对话
# ② 生成脚本（dailog 编辑规范见 skill：.agents/skills/dailog-editor/SKILL.md）→ script.json
pnpm editor --env <环境名> tts <submissionId> --script script.json [--language zh|en] [--guest claude]
#   · 统一走服务端 /v1/editor/tts 端点（Fish key 只在服务端；multi speaker 整集一次合成 → full.mp3）
#   · guest 声线在服务端配置（guest-voice 上传；guest-set 设置称呼）；tts 传 --guest <platform>
pnpm editor --env <环境名> merge <submissionId> [--language zh|en] [--intro x.mp3] [--outro x.mp3]
#   · intro/outro 统一自动匹配语言：assets/intro.{lang}.mp3（语言专属缺失 → fallback 通用 intro.mp3）
#   · 资产命名：{intro|outro}.{lang}.mp3（语言专属，可选）；通用 {intro|outro}.mp3 兜底
#   · --intro/--outro 可显式指定本地文件（临时替换）；资产缺失时警告跳过
pnpm editor --env <环境名> cover <submissionId> [--texture squares] [--colors "#020617,#22d3ee"] [--image-url <URL>]
#   · 默认纹理+配色随机（6 种几何平铺 × 10 配色组）；不满意贴 URL 裁剪——无 Pexels 依赖
pnpm editor --env <环境名> publish <submissionId> --title "..." [--cover cover.jpg]
pnpm editor --env <环境名> reject <submissionId> --reason "..."
```

## 前置要求

- Node ≥ 22（仓库引擎要求）+ 本机 `ffmpeg` / `ffprobe`（TTS 参考转码与合成）
- `.dailog-editor/.env`（密钥）+ `.dailog-editor/envs.json`（环境清单）配置完成
- 目标环境已 `login` 配对（auth-status 可检查）
- API 可达（本地 `pnpm dev:orb` 或生产）
