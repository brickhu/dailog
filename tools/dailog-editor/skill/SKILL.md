---
name: dailog-editor
description: >
  dailog是一个将「人机聊天记录」模拟为真人采访AI的播客，该SKILL是面向编辑人员的本地管理工作台。该技能承载如下几个方面的功能：
  1. 概要：概要信息查询，例如N条待处理投稿，用户多少... 通常通过"dailog","dailog overview"，"/dailog-editor"显性触发；
  2. 采集：批量采集用户的投稿的原始聊天记录，用户投稿本质是分享一个「人机聊天记录」的URL，通过URL匹配采集器获取具体的聊天记录,通常通过"采集"，"采集:{ID}"触发；
  3. 脚本：该工作流细分为2步：① 确定选题方向；② 脚本生成（内容 + 听感打磨）；通常通过"生产脚本:{ID}"，"生成{ID}的脚本"触发，用户直接输入"生成脚本"拉取列表选号触发；
  4. TTS：调用Fish-Audio的api接口生成语音（分段合成 --parts——片头插在点题与对谈之间，支持单段重跑），然后通过本地ffmpeg合成语音文件(m4a)，并调用本地播放器(首选quicktime player)打开播放，通常通过"TTS:{ID}"，"生成语音:{ID}"触发，用户直接输入"生成语音"，"TTS"拉取列表选号触发；
  5. 发布：将已生成了语音的投稿生成为节目的封面，标题，简介，摘要，参考信息，等结构化数据，让用户确认后发布，通过"发布"选号触发或"发布:{ID}"单条触发；
  6. 管理：对已经发布的节目进行重新生成，修改封面，标题等操作；通过"修改标题:{ID}","修改简介:{ID}","重新生成:{ID}"等方式触发；
  7. 配置：编辑人员可在agent工作台中配置播放列表，AI嘉宾信息，AI嘉宾音色等，通常通过"配置XX"触发
---

# Dailog Editor

面向Dailog编辑人员的本地管理工作台，承载 **7 项功能**（与 description 一一对应）：
**① 概要（OV）｜ ② 采集（CL）｜ ③ 脚本（SC）｜ ④ TTS｜ ⑤ 发布（PUB）｜ ⑥ 管理（MGT）｜ ⑦ 配置（CFG）**。
全部动作由 Agent + CLI（`pnpm editor <cmd>`）完成。

**文档结构（片段切分）**：本文件是**索引枢纽**——只含各功能**定义 / 用途 / 触发**与全局前置；
每个功能的操作细节（流程 / 输入 / 确认门 / 输出 / 错误处理）在独立分册 `docs/*.md`，见「编号规范」文件索引表。

1. CLI：命令入口 `pnpm editor <cmd>`（根目录）；源码 `tools/dailog-editor/`，CLI 是打通本地 Agent 工作台和 dailog API 之间的桥梁
2. 该技能仅面向拥有编辑权限的账号开放；Agent 对话触发 skill 时，通过 CLI 的用户授权配对将 API bearer key 注入会话
3. 技能配套目录缓存工作流临时文件/日志/环境变量，位于项目根 `.dailog-editor/`（gitignored）
4. 技能区分环境：环境清单 `.dailog-editor/envs.json`（模板 `tools/dailog-editor/templates/envs.example.json`）
5. 涉及 Fish Audio / Pexels 密钥：从 `.dailog-editor/.env` 获取（gitignored，chmod 600）
6. DSH 沙箱 pnpm EPERM（版本不匹配）→ 直调 `node .agents/skills/dailog-editor/scripts/run.js`
7. 本机有 `ffmpeg` / `ffprobe`（采样转码 + 合成）；草稿目录 `.dailog-editor/drafts/` 自动创建

## 名词口径（全文统一）

| 名词 | 统一口径 |
|---|---|
| 投稿（submission） | 用户分享的「人机聊天记录」URL（附主持人采样）；全流程以 `submissionId` 驱动 |
| 采集 | 拉取投稿 URL 并**解码提取对话原文**（命令 `fetch`）；**默认批量**（`batch` 并发） |
| 对话原文 | `dialogue.json`（`[{role, content}]`），脚本 / TTS / 发布的唯一事实来源 |
| 主持人（host） | 即投稿人；脚本 host 角色，开场自我介绍用称呼 `callName` |
| 嘉宾（guest） | AI 对谈对象（AI 嘉宾）；声线在服务端配置 |
| 声线 | 嘉宾的声音配置（即「音色」）；`guests` / `guest-voice` / `guest-set` 管理 |
| 节目（episode） | 一个期次；「期号」= 节目编号；以 `episodeId` 定位 |
| 脚本 | 三段对谈稿（part1 点题 / part2 对谈 / part3 落点+收束）；两步：**选题方向 → 脚本生成（内容+听感打磨）** |
| TTS（生成语音） | 分段调用 Fish TTS 生成语音 + ffmpeg 合成 m4a + 本地播放器试听 |
| 发布 | 为已生成语音的投稿制作**封面 + 元数据**（标题/简介/摘要/标签/分类/金句/参考信息/封面关键词），确认后发布（publish）或拒审（reject） |
| 管理 | 已发布节目的重新生成、修改标题/简介/封面、下线申请审批 |
| 配置 | 在 Agent 工作台配置播放列表 / AI 嘉宾信息 / AI 嘉宾声线 |
| 确认门 | 选题 / 终稿 / 语音 / 发布 四道确认门，选项编号收口、统一选号格式（RULES-10） |
| 拒稿（拒审） | 拒绝一篇投稿；原因必填且具体（投稿人可见）；规范见 REJ |
| 草稿目录 | `.dailog-editor/drafts/{submissionId}/`，存全部中间产物 |

## 编号规范（索引体系 + 文件索引）

- **章节码**：OV 概要 / CL 采集 / SC 脚本 / TTS / PUB 发布 / MGT 管理 / CFG 配置；附录 BATCH 批量 / REJ 拒稿 / RES 进度恢复 / DRAFT 草稿目录 / FB 编辑反馈日志 / TOOL 工具链 / RULES 红线
- **节码**（每章固定 6 段式；**「定义 / 用途及触发机制」为主文档索引段，不参与编号**，其余 5 节编码，见分册）：
  - `<章节码>-FLOW` 流程 / 原则 / CLI 调用逻辑
  - `<章节码>-IN` 输入规范与依赖
  - `<章节码>-GATE` 确认门选项与输出模板（内含具体门 `<章节码>-GATE-<n>`）
  - `<章节码>-OUT` 输出物存放与命名标准
  - `<章节码>-ERR` 错误处理
- **步骤码**：`<章节码>-STEP-<n>`（如 SC-STEP-1 选题方向、TTS-STEP-2 合成、PUB-STEP-3 发布确认门）
- **确认门码**：`<章节码>-GATE-<n>`（SC-GATE-1 选题 / SC-GATE-2 终稿 / TTS-GATE-1 语音 / PUB-GATE-1 发布）
- **红线码**：RULES-1..11
- **索引层级**：`SC-GATE-2`（终稿确认门）⊂ `SC-GATE`（确认门节）⊂ `SC`（脚本章节）；引用写作「见 SC-GATE-2」「见 REJ」「见 RULES-9」

**文件索引表**（所有分册相对本文件路径，产物同步到 `.agents/skills/dailog-editor/docs/`）：

| 章节 | 码 | 分册 | 步骤 | 确认门 | 节码 |
|---|---|---|---|---|---|
| 概要 | OV | docs/OV.md | OV-STEP-1..3 | — | OV-FLOW / OV-IN / OV-GATE / OV-OUT / OV-ERR |
| 采集 | CL | docs/CL.md | CL-STEP-1..3 | — | CL-FLOW / CL-IN / CL-GATE / CL-OUT / CL-ERR |
| 脚本 | SC | docs/SC.md | SC-STEP-1..2 | SC-GATE-1..2 | SC-FLOW / SC-IN / SC-GATE / SC-OUT / SC-ERR |
| TTS | TTS | docs/TTS.md | TTS-STEP-1..3 | TTS-GATE-1 | TTS-FLOW / TTS-IN / TTS-GATE / TTS-OUT / TTS-ERR |
| 发布 | PUB | docs/PUB.md | PUB-STEP-1..3 | PUB-GATE-1 | PUB-FLOW / PUB-IN / PUB-GATE / PUB-OUT / PUB-ERR |
| 管理 | MGT | docs/MGT.md | MGT-STEP-1..3 | 复用 SC/TTS/PUB 门 | MGT-FLOW / MGT-IN / MGT-GATE / MGT-OUT / MGT-ERR |
| 配置 | CFG | docs/CFG.md | CFG-STEP-1..2 | — | CFG-FLOW / CFG-IN / CFG-GATE / CFG-OUT / CFG-ERR |
| 批量流水线 | BATCH | docs/BATCH.md | BATCH-STEP-1..9 | 复用 TTS-GATE-1 + PUB-GATE-1 | — |
| 拒稿规范 | REJ | docs/REJ.md | — | — | — |
| 进度与恢复 | RES | docs/RES.md | — | — | — |
| 草稿目录 | DRAFT | docs/DRAFT.md | — | — | — |
| 反馈日志 | FB | docs/FB.md | FB-STEP-1..3 | — | FB-FLOW / FB-IN / FB-OUT / FB-ERR |
| 工具链要点 | TOOL | docs/TOOL.md | — | — | — |
| 红线 | RULES | docs/RULES.md | RULES-1..11 | — | — |

## Triggers

| 分类 | 主关键词 | 说明 | 关键词变体 | 分册 |
|---|---|---|---|---|
| 概要（OV） | `dailog` | 触发工作台概要 | `/dailog-editor`, `dailog overview`, `dailog概要`, `概要` | docs/OV.md |
| 采集（CL） | `采集` | 批量按投稿 URL/ID 拉取原始聊天记录并解码落盘（fetch → dialogue.json，默认批量） | `采集:{ID}`、`采集 {ID}`、直接粘贴投稿 URL | docs/CL.md |
| 脚本（SC） | `生成脚本` | 进入脚本工作流：选题 → 终稿（两确认门） | `生产脚本:{ID}`、`生成{ID}的脚本`、`脚本:{ID}` | docs/SC.md |
| TTS | `TTS` | 分段调用 Fish TTS 生成语音，ffmpeg 合成 m4a 并本地试听 | `生成语音`、`TTS:{ID}`、`生成语音:{ID}` | docs/TTS.md |
| 发布（PUB） | `发布` | 生成封面/标题/简介/摘要/元数据，确认后发布或拒审 | `发布:{ID}`、`发布 {ID}`、`拒审` | docs/PUB.md |
| 管理（MGT） | `重新生成` | 已发布节目的重做与修改（期号/链接不变） | `修改标题:{ID}`、`修改简介:{ID}`、`重新生成:{ID}`、`重新生成第 N 期` | docs/MGT.md |
| 配置（CFG） | `配置` | 在 Agent 工作台配置播放列表 / AI 嘉宾信息 / 嘉宾音色（playlist / guests / guest-voice / guest-set） | `配置播放列表`、`配置嘉宾`、`配置嘉宾音色`、`配置音色`、`配置声线`、`播放列表`、`playlist`、`歌单` | docs/CFG.md |

## 会话初始化（环境确认门——新开对话的第一道强制门槛）

**ENV-GATE 环境确认门（必须，硬门槛）**：新开对话触发 dailog-editor 后，**第一步必须先过本门**——
在任何功能操作（概览/采集/脚本/TTS/发布/管理）之前：
```
① 读 .dailog-editor/envs.json 列出环境清单 → **请编辑明确确认本次访问哪个环境**
  （必须让编辑选择；不默认、不猜测、不沿用旧对话记忆）
② pnpm editor --env <环境> auth-status：先打 /health 验证端点可用（不可达 → 换环境/查网络，不继续），
  再查授权：✅ 有效 → 记下环境名，本对话后续命令全部带 --env <环境>；❌ → 走 ③
③ 配对码登录：pnpm editor --env <环境> login（终端给授权链接）→ 编辑浏览器打开登录 →
  把页面显示的配对码贴回对话 → pnpm editor --env <环境> login --code <配对码> 完成配对
  （token 绑定该环境缓存本地；已登录略过）
```
**未过门禁令**：环境未确认 / 授权未验证 → **不执行任何功能（连概览也不展示）**——直接向编辑发起环境确认，
确认并验证通过后才进入功能。环境 + 授权是**会话级状态**：新开对话一律重走本门，不跨会话继承（RULES-11）。
环境一旦确认，本对话所有命令统一带该 `--env <环境>`；编辑说「换个环境」→ 重走本门（login --force 重配对）。

要点：
- **环境必须显式**：多环境下命令不带 --env 会列出清单拒绝执行——防「以为是 dev 实际打到 prod」
- **token 绑定环境**：dev 的 token 不能用于 prod；用户说「换个环境」→ 重走 ①-④（login --force 重配对）
- **配对交接（红线）**：`login` 在非交互环境只创建授权并打印 URL 后返回，**绝不自行抓取/读取配对码**
  ——把 URL 给编辑在浏览器打开，编辑把页面显示的配对码贴回对话，agent 用 `login --code` 提交；
  不得 GET 授权页偷码、不得伪造/编造配对码，必须等编辑回贴

> 以下所有 `pnpm editor` 命令均带会话选定环境（`--env <环境>` 或 `DAILOG_ENV`），下文省略。
> **功能间关系（不作串行绑定）**：CL（采集）为 SC/TTS/PUB 提供对话原文；SC（脚本）终稿两关（SC-GATE-1/2）通过后
> 进 TTS；TTS 语音经试听确认（TTS-GATE-1）后进 PUB（发布）。各功能独立触发、独立完成。

## OV 概要（Overview）

**定义 / 用途及触发机制**
定义：概要信息查询——环境 / 网站 / 账号 / 共计投稿与发布 / 采集·脚本·语音·节目 四管道待处理与共计 / 待处理选项 / 其他功能入口。
用途：用户说「dailog」「overview」「概要」等时——**先过环境确认门（ENV-GATE，见「会话初始化」）**，确认后直接展示工作台概要（不进入完整流程），提供各功能的入口导航。
触发：`dailog`、`dailog overview`、`/dailog-editor`、`概要`。

→ 完整操作（OV-FLOW 流程 / OV-IN 输入 / OV-GATE 选号菜单 / OV-OUT 输出 / OV-ERR 错误）：见 `docs/OV.md`

## CL 采集（Collect）

**定义 / 用途及触发机制**
定义：批量采集用户投稿的原始聊天记录——投稿即「人机聊天记录」URL，通过 URL 匹配采集器解码提取对话原文；**默认批量**。
用途：把用户投稿（人机聊天 URL）拉取并**解码提取对话原文**（dialogue.json），作为脚本 / TTS / 发布的唯一事实来源；默认批量并发。
触发：`采集`、`采集:{ID}`、直接粘贴投稿 URL。

→ 完整操作（CL-FLOW 流程 / CL-IN 输入 / CL-GATE 输出模板 / CL-OUT 输出 / CL-ERR 错误）：见 `docs/CL.md`

## SC 脚本（Script）

**定义 / 用途及触发机制**
定义：脚本工作流细分 2 步——① 确定选题方向（SC-STEP-1）；② 脚本生成（内容 + 听感打磨，SC-STEP-2）。
用途：把对话原文制作成**三段对谈脚本**（part1 点题 / part2 对谈 / part3 落点+收束），两步各带确认门；全部通过才进 TTS。
触发：`生产脚本:{ID}`、`生成{ID}的脚本`；直接输入 `生成脚本` 拉取列表选号。

→ 完整操作（SC-FLOW 流程 / SC-IN 输入 / SC-GATE 两确认门 SC-GATE-1..2 / SC-OUT 输出 / SC-ERR 错误）：见 `docs/SC.md`

## TTS 生成语音（Voice）

**定义 / 用途及触发机制**
定义：调用 Fish-Audio API 生成语音（分段合成 `--parts` 为标准流程——片头插在点题与对谈之间；整集 full.mp3 仅旧流程兜底）→ 本地 ffmpeg 合成 m4a → 本地播放器（QuickTime）打开试听。
用途：把终稿脚本（script.json）合成可发布的语音成品（final.m4a），本地试听确认。
触发：`TTS:{ID}`、`生成语音:{ID}`；直接输入 `生成语音`、`TTS` 拉取列表选号。

→ 完整操作（TTS-FLOW 流程 / TTS-IN 输入 / TTS-GATE 语音确认门 TTS-GATE-1 / TTS-OUT 输出 / TTS-ERR 错误）：见 `docs/TTS.md`

## PUB 发布（Publish）

**定义 / 用途及触发机制**
定义：将已生成语音的投稿生成为封面、标题、简介、摘要、参考信息等结构化数据，让编辑确认后发布。
用途：为已通过语音确认的投稿制作**封面 + 元数据**，经发布确认门后发布（publish）或拒稿（reject）。
触发：`发布` 选号 或 `发布:{ID}` 单条。

→ 完整操作（PUB-FLOW 流程 / PUB-IN 输入 / PUB-GATE 发布确认门 PUB-GATE-1 / PUB-OUT 输出 / PUB-ERR 错误）：见 `docs/PUB.md`

## MGT 管理（Manage）

**定义 / 用途及触发机制**
定义：对已发布节目重新生成、修改封面/标题等。
用途：已发布节目的重新生成（republish）、修改标题/简介/封面、下线申请审批。
触发：`修改标题:{ID}`、`修改简介:{ID}`、`重新生成:{ID}`、`重新生成第 N 期`。
⚠️ **重新生成不重跑选题审核（SC-STEP-1）**：已发布节目选题已确认——本地有 chosen-idea.json 直接复用，
   没有则沿用旧角度；仅编辑明确要求换角度才重跑，且只列思路不拒稿（选题门槛只用于首次决策，见 MGT-FLOW）。

→ 完整操作（MGT-FLOW 流程 / MGT-IN 输入 / MGT-GATE 复用门 / MGT-OUT 输出 / MGT-ERR 错误）：见 `docs/MGT.md`

## CFG 配置（Config）

**定义 / 用途及触发机制**
定义：在 Agent 工作台配置播放列表、AI 嘉宾信息、AI 嘉宾音色等。
用途：在 Agent 工作台配置三类内容：播放列表（平台策展）、AI 嘉宾信息与声线。
触发：`配置XX`（如 `配置播放列表`、`配置嘉宾`、`配置音色`）。

→ 完整操作（CFG-FLOW 流程 / CFG-IN 输入 / CFG-GATE / CFG-OUT 输出 / CFG-ERR 错误）：见 `docs/CFG.md`

## 附录（跨功能机制）

| 附录 | 码 | 分册 | 说明 |
|---|---|---|---|
| 批量流水线 | BATCH | docs/BATCH.md | 批量采集 → 批量脚本 → produce，人工只在决策点介入（BATCH-STEP-1..9） |
| 拒稿规范 | REJ | docs/REJ.md | 拒绝一篇投稿：发生点 / 原因规范 / 状态通知（被 SC-GATE、PUB-GATE、BATCH、MGT 引用） |
| 进度与恢复 | RES | docs/RES.md | 会话中断不丢：progress.json 断点续跑 |
| 草稿目录 | DRAFT | docs/DRAFT.md | 中间产物统一存放与发布后清理 |
| 工具链要点 | TOOL | docs/TOOL.md | 运维记忆（callName / 采样匹配 / publish 无响应 / R2 / EPERM 等） |
| 红线 | RULES | docs/RULES.md | RULES-1..9 跨功能底线（呈现通道 / 试听 / 确认门 / 拒稿原因等） |

## 使用提示

> **分册路径解析**：`docs/`、`reference/`、`prompts/` 均为技能根同级目录——源码 `tools/dailog-editor/{docs,reference,prompts}/`，产物 `.agents/skills/dailog-editor/{docs,reference,prompts}/`；
> 文中 `docs/X.md` 相对技能根解析（<skillDir>=.agents/skills/dailog-editor，<drafts>=.dailog-editor/drafts）。

- **每个新对话先做**：会话初始化（环境 + 配对）→ 用户意图落到某个功能（Triggers）→ 打开对应分册执行
- **索引优先**：遇到未列出的名词/步骤，按「编号规范」的码体系回溯（如 SC-GATE-2 在 docs/SC.md 的 SC-GATE 节）
- **跨功能联动**：REJ（拒稿）被 SC-GATE-1/2、PUB-GATE-1、BATCH-STEP-1/3、MGT-STEP-3 引用；RULES 被全文引用；RES 用于任何中断恢复
