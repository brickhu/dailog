---
name: dailog-editor
description:
  dailog 编辑本地工作流（一条龙）。用户（编辑）给出投稿 ID、或让本技能拉取待审队列时：
  拉取队列/详情 → 本地拉取网页内容 → 按 dailog 标准生成脚本 → Fish TTS 合成语音 →
  ffmpeg 合成 → 节目信息与封面 → 一次性上传发布（或拒审）。覆盖本质版编辑管线的全部动作。
  触发方式两种：① 显性触发（编辑投稿/批量处理/overview 等关键词）；② "dailog" 或
  "dailog overview" 直接触发工作台概要（环境 + 编辑账号 + 三类待办计数）。
triggers:
  - 编辑投稿
  - 审核投稿
  - 制作节目
  - 拉取队列
  - 投稿队列
  - 待审投稿
  - 生成脚本
  - 合成语音
  - 发布节目
  - 拒审
  - 重新生成节目
  - 重新制作节目
  - 重做节目
  - 更新已发布节目
  - 重新跑一遍工作流
  - regenerate
  - republish
  - 编辑工作流
  - editor
  - publish episode
  - dailog 编辑
  - dailog overview
  - dailog
  - overview
  - 概要
  - 工作台概要
  - 当前有什么待办
---

# Dailog Editor · 编辑本地 Agent 工作流（一条龙）

**本质版架构**：用户只提交 URL + 声音采样 → 落库待审核；编辑在本地 Agent 完成内容拉取、脚本、
语音、合成、封面，成品一次性上传发布。服务端不做任何采集/生成。

```
用户投稿（site）: URL（合法性+触达性检查）+ 采样 → submissions(status=submitted)
编辑（本技能）: list → detail → fetch 解码（阶段 0）→ 生成（阶段 1：选题/草稿/终稿三确认门）
              → tts → merge（试听）→ cover → **语音确认门（试听通过才进入元数据）**
              → 发布（阶段 2：元数据生成 + 发布确认门）→ publish / reject
```

## 前置条件

- `.dailog-editor/.env`（Fish/Pexels 密钥）与 `.dailog-editor/envs.json`（**环境清单**，
  模板 `tools/dailog-editor/templates/envs.example.json`）已配置
- 本机有 `ffmpeg` / `ffprobe`（采样转码 + 合成）；草稿目录 `.dailog-editor/drafts/` 自动创建
- 命令入口：`pnpm editor <cmd>`（根目录）；源码 `tools/dailog-editor/`
- DSH 沙箱 pnpm EPERM（版本不匹配）→ 直调 `node .agents/skills/dailog-editor/scripts/run.js`
  （详见 `reference/toolchain-notes.md`）

## 工作台概要（dailog / overview 直接触发）

用户说「dailog」「overview」「概要」等时——**直接展示工作台概要**（不进入完整流程）：

```
① 会话初始化（选环境 → auth-status，未配对先引导 login）
② pnpm editor overview → 展示：环境 / 编辑 / 1.待审批 / 2.脚本待生成语音 / 3.语音待发布 / 4.下线申请
   → 选号：[1] 📥 审核投稿 ｜ [2] 🎙️ 制作脚本 ｜ [3] 🚀 发布 ｜ [4] 🚫 下线申请审批 ｜
           [5] 📋 节目/播放列表 ｜ [6] ⚙️ 其他（批量/嘉宾声线/重做…）
③ 按所选编号进入对应流程
```

## 会话初始化（每个新对话必做——环境与配对是会话级状态）

```
① 读 .dailog-editor/envs.json 列出环境清单 → 询问编辑本次访问哪个环境
  （用户已指定 → 用之；否则必须问，不默认）
② pnpm editor --env <环境> auth-status：先打 /health 验证端点可用（不可达 → 换环境/查网络，不继续），
  再查授权：✅ 有效 → 记下环境名，本对话后续命令全部带 --env <环境>；❌ → 走 ③
③ 配对码登录：pnpm editor --env <环境> login（终端给授权链接）→ 编辑浏览器打开登录 →
  把页面显示的配对码贴回对话 → pnpm editor --env <环境> login --code <配对码> 完成配对
  （token 绑定该环境缓存本地；已登录略过）
④ 新开对话 → 回到 ① 重新确认环境 + 授权
```

要点：
- **环境必须显式**：多环境下命令不带 --env 会列出清单拒绝执行——防「以为是 dev 实际打到 prod」
- **token 绑定环境**：dev 的 token 不能用于 prod；用户说「换个环境」→ 重走 ①-④（login --force 重配对）
- **配对交接（红线）**：`login` 在非交互环境只创建授权并打印 URL 后返回，**绝不自行抓取/读取配对码**
  ——把 URL 给编辑在浏览器打开，编辑把页面显示的配对码贴回对话，agent 用 `login --code` 提交；
  不得 GET 授权页偷码、不得伪造/编造配对码，必须等编辑回贴

## 工作流（一条龙）

```
用户: "审核投稿" / 给 submissionId / 粘贴 URL
  ↓ ① 会话初始化（选环境 → auth-status）
  ↓ ② 拉取队列或详情
  ↓ ③ 阶段 0 · 解码（独立，不跑生成）：pnpm editor fetch <id> 解码落盘
  │    → 呈现列表（ID + 投稿人 + 标题 + URL）→ 编辑输入 ID 进入生成工作流
  ↓ ④ 阶段 1 · 生成（单条编号驱动，子代理执行，见 ④）：
  │    1.1 审稿+选题（dailog-select）→ 选题确认门（选号/拒稿）
  │    1.2 脚本草稿（dailog-draft）→ 草稿确认门（下一步/修改/拒稿）
  │    1.3 听感打磨（dailog-polish）→ 终稿确认门（确认/修改/拒稿）
  │    → 进 tts 前内容核查（fact_check_list / privacy_redactions）+ 嘉宾声线预检
  ↓ 1.4 pnpm editor tts <id> --script script.json --language <lang> [--guest <platform>]
  ↓ 1.5 pnpm editor merge <id> --language <lang>（final.m4a；合成完成自动用 QuickTime 打开试听）
  ↓ 1.6 pnpm editor cover <id> [--guest <platform>]（封面 Read 展示给编辑）
  ↓ 阶段 2 · 发布（节目标号驱动）：
  │    2.1 元数据生成（dailog-meta → metadata.json，基于终稿）
  │    2.2 发布确认门：元数据逐项 + 封面 + 试听 → 编辑确认 → publish / reject
  ↓ 汇报：期号/节目链接 或 拒审原因
```

> 本工作流中所有 `pnpm editor` 命令均带会话选定环境（`--env <环境>` 或 `DAILOG_ENV`），下文省略。

### ② 队列与详情

```bash
pnpm editor list                  # 待审队列（先到先审；⚠️无采样 = 无法克隆主持人音色）
pnpm editor detail <submissionId> # URL/投稿人/主持人称呼(callName)/节目建议/采样 transcript/画像
pnpm editor removal               # 节目下线申请队列（approve 下架+通知 / reject 拒绝+通知）
```

### ③ 阶段 0 · 解码（独立步骤，不跑生成工作流）

- 命令：`pnpm editor fetch <id>` → 拉取投稿 URL 并解码落盘草稿目录：`page.html`（原始 HTML）/
  `page.txt`（清洗后正文）/ `dialogue.json`（`[{role, content}]`）
- 本步只做**提取与解码**（LLM 按 URL 匹配内容解码器），**不跑任何生成**；解码完成即落盘
- **完成后呈现列表**：ID + 投稿人 + 标题（页面标题，无则省略）+ URL——编辑**输入 ID** 进入阶段 1
- 平台分派 / 代理兜底 / 浏览器兜底 / 解码规则自进化 / 平台经验库：**详见 `reference/fetch-decoding.md`**
- 拉取失败（403/超时/失效）→ 如实汇报，引导编辑走浏览器控制台兜底

### ④ 阶段 1 · 生成工作流（单条编号驱动，子代理执行）

> **为什么用子代理**：对话原文（15-20k tokens）与提示词文件（合计 ~14k tokens）只进子代理上下文；
> 结果由子代理**直接写盘**，主会话只收一行校验摘要；展示内容从草稿文件读出放回复正文。
> 单期主会话增量 ~15-25k。**子代理完整 prompt 模板（1.1/1.2/1.3 + 2.1）见 `reference/subagent-templates.md`**
> （路径按实际情况补全：<skillDir>=.agents/skills/dailog-editor，<drafts>=.dailog-editor/drafts）。

| 步骤 | 子代理 | 输入 | 输出（写盘） | 确认门 |
|---|---|---|---|---|
| 1.1 审稿+选题 | `dailog-select` | selection.md + dialogue.json + 节目建议 | selection.json（content_summary + ideas[1..N] 各带 score）或 quality.json | ① 选题 |
| 1.2 脚本草稿 | `dailog-draft` | draft.md + five-beats.md + templates.md + chosen-idea.json + dialogue.json | script-draft.json（三段纯文本无标签） | ② 草稿 |
| 1.3 听感打磨 | `dailog-polish` | polish.md + script-draft.json + chosen-idea.json + dialogue.json | script.json（终稿带标签 + optimization_summary） | ③ 终稿 |

- 1.1 确认门编辑选号 N → 主会话把 ideas[N-1] 写入 `drafts/{id}/chosen-idea.json`（角度锚点）
- **打回重跑**：听感反馈（呈现层）→ 重跑 1.3；结构反馈（换角度/切主题/加删回合）→ 重跑 1.2；
  换选题角度 → 回 1.1 重新选号。修订指令：prompt 末尾追加「修订指令：<编辑要求>」
- **内容规范以提示词文件为准**（主会话不重复载入）：
  - `prompts/selection.md`（1.1）：G1-G5 闸门 + 时刻门（问题归位测试）+ 逻辑骨架 + 价值维度 + 打分
  - `prompts/draft.md` + `five-beats.md` + `templates.md`（1.2）：五拍结构 + 四模板选型 → 三段草稿
  - `prompts/polish.md`（1.3）：情绪设计 + 现场感铁律 + 话题转移 + 检查清单（不输出元数据）
  - `prompts/meta.md`（2.1 发布准备）：基于**终稿**生成 title/summary/description/tags/coverKeywords/category/references/highlights
  - 产物在 `.agents/skills/dailog-editor/prompts/`，源码 `tools/dailog-editor/prompts/`
- **提示词保真**：提示词文件由**生成子代理原样读取**作为系统提示词，任何人不许改写压缩
- **节目建议（角度锚点）**：detail 的「节目建议」是用户呈现意图的最强信号——1.1 以它为角度约束
  （时刻与骨架落在建议路径上），冲突取舍写进 suggestion_decision；1.2/1.3 经 chosen-idea.json
  继承，脚本角度不得偏离（polish.md 铁律 6）

#### 确认门（阶段 1 三关：选题 → 草稿 → 终稿，逐关确认）

> **交互**：选项编号呈现，编辑点击/回复编号即可；修改类选项附一句说明。
> **呈现通道红线（所有环境通用，GUI 尤甚）**：一切面向编辑的展示——内容概括 / 选题思路 / **脚本
> 草稿与终稿全文** / 配套产物 / 封面图（Read 图片） / 节目元数据——**必须出现在 agent 回复正文**
> （脚本全文单个 code block 整篇）；**禁止用工具输出（console.log / 命令 stdout / 子代理返回）
> 承载展示**——GUI 里工具输出默认折叠、对编辑不可见（编辑会问「在哪儿？看不到」）。子代理 JSON
> 直接写盘，主会话不打印全文；工具输出只用于校验与调试。

```
三关逐关确认，任何一关打回即重跑对应子代理；全部通过才进 tts（1.4）。
（元数据属发布层：阶段 2 发布确认门与封面/试听一并确认，见下。）

  ① 选题确认门（1.1 pass 后）：
     · 展示：原文内容概括（3-5 句）+ 选题思路列表（1..N，每个：why_this_idea + title_draft +
       score，按得分排序，推荐标 ⭐）
     · 选项：[1..N] ✅ 选第 N 个思路 ｜ [R] ❌ 拒稿 → reject ｜ [M] ✏️ 修改（附说明重跑 1.1）
  ② 草稿确认门（1.2 生成后）：
     · 展示：三段脚本草稿，分别三个 code block（part1 开场+点题 / part2 对话主题 / part3 落点+收尾），
       纯文本无情绪标签 + draft_notes
     · 选项：[1] ✅ 下一步 → 听感打磨 ｜ [2] ✏️ 提修改意见（附说明重跑 1.2）｜ [3] ❌ 拒稿
  ③ 终稿确认门（1.3 生成后）：
     · 展示：终稿全文（单个 code block 整篇）+ 优化总结（optimization_summary，逐条）
       + 摘要（script-preview）作附加信息
     · 嘉宾声线预检：进 tts 前 pnpm editor guests 确认目标嘉宾（--guest <platform>）有声线；
       ⚠️ 无声线 → 本门内立即告知编辑（上传声线/换有声线嘉宾/暂停），不得闷头跑 tts 到 422
     · 质量自检：现场感/角度保真/结构对照/转场 + **称呼核对（开场自我介绍 = detail 的
       callName，非「主持人」泛称）** + **听众视角抽查（host 抛出符号/术语/专名前有无承接；
       二人对话逻辑是否接得住）**（对照 polish.md 本质节 + 铁律 5/6/7 + 检查清单）——
       不合格打回重生成
     · 选项：[1] ✅ 确认 → tts ｜ [2] ✏️ 提交修改意见（听感，附说明）→ 重跑 1.3 ｜
       [3] ✏️ 结构反馈（附说明）→ 重跑 1.2 ｜ [4] ❌ 拒稿
```

**红线**：脚本未经三个确认门（选题/草稿/终稿）全部通过不得进入 tts；「把脚本展示出来我看看」
是默认态（终稿全文默认在正文），不得让编辑催第二遍。发布层面（元数据/封面/试听）在阶段 2 发布确认门一并确认。

### 1.4 TTS（`pnpm editor tts <id> --script script.json [--language zh|en] [--guest <platform>]`）

- 整集一次合成（multi speaker，默认）或 `--parts` 三段落合成（推荐：单段更稳、可 `--part n` 单段重跑）
- **统一走服务端端点**——编辑本地不直连 Fish Audio，Fish key 只配在服务端；host=投稿人采样，
  guest=服务端 guest_voice_samples 声线：`pnpm editor guests` 查看、`guest-voice <id> --audio <file>`
  上传、`guest-set <id> --name` 改称呼；未配置声线 → 422，先在终稿确认门解决
- 产物 `full.mp3`；失败：汇报错误（Fish 余额/限流/超时），按提示重跑该段（--part n）或整集

### 1.5 合成（`pnpm editor merge <id> [--language zh|en]`）

- intro/outro 按语言自动匹配（`assets/intro.{lang}.mp3`，缺失 fallback 通用资产）；段间插 0.6s 静音
- 产物 `final.m4a`；**merge 完成自动用 QuickTime Player 打开试听**（macOS）——**发布前必须试听**
  （音色/断句/情绪标签）；异常 → 修好再发

### 1.5b 语音确认门（**试听通过后才进入阶段 2 元数据生成**）

- **顺序红线**：TTS/merge 出语音后，必须先经编辑试听确认，**通过后才允许开始 2.1 元数据生成**
  （dailog-meta）——语音是内容核心，音色/断句/情绪不过关时先修（--part n 重跑单段或整集），
  不浪费 token 生成注定要改的元数据
- 交互：[1] ✅ 试听通过 → 进 1.6 封面 + 阶段 2 元数据 ｜ [2] 🔊 哪段有问题 → 重跑 tts --part n →
  重新 merge 试听 ｜ [3] 🎨 顺带重做封面（1.6 亦可后置到发布确认门）

### 1.6 封面（`pnpm editor cover <id> [--texture ...] [--colors "#hex,#hex"] [--guest <platform>] [--image-url <URL>]`）

- 默认：纹理指令预置库随机（无 Pexels 依赖）→ 1400×1400 JPEG；居中「主持人称呼 × 嘉宾称呼」
  （callName × guests 表 name，超宽自动缩字号，文字颜色按底色明暗）
- 不满意 → `--image-url <URL>`（下载裁切）；**生成后立即把封面图 Read 展示给编辑**（确认环节再展示）

### 阶段 2 · 发布（节目标号驱动，与编辑确认后执行）

> **前置红线**：阶段 2 必须在 **1.5b 语音确认门通过后**才开始——未经编辑试听确认的语音，
> 不得进入 2.1 元数据生成（语音未确认时元数据生成属于浪费且顺序违规）。

**2.1 元数据生成（子代理 dailog-meta——发布准备，基于终稿）**：
- 起子代理（模板见 `reference/subagent-templates.md`），读取 `prompts/meta.md` + script.json（终稿）+
  chosen-idea.json + dialogue.json → 生成 title / summary / description / tags / coverKeywords /
  category / references / highlights → 写入 `drafts/{id}/metadata.json`
- **基于终稿**：金句逐字来自终稿 segments；脚本修改（重跑 1.2/1.3）后须重跑本步
- 产物 metadata.json：publish 自动读取（description/highlights/category/summary；旧草稿 fallback script.json）

**2.2 发布确认门（元数据 + 封面 + 试听，一并确认）**：
- 展示（回复正文）：**metadata.json 全部字段逐项列出**（标题 / 简介 / 摘要 / 标签 / 分类 / 金句 /
  references——references 外链须人工确认无编造，链接安全红线）+ **封面图 Read 直出** + 试听确认
  （merge 已自动打开 final.m4a）——不要只给标题+封面
- --description/--tags 可覆盖，与最终 title/category 不匹配则重生成一版再确认
- 确认交互：[1] ✅ 确认发布 ｜ [2] ✏️ 改元数据（附说明）→ 重跑 2.1 ｜ [3] 🎨 重做封面 ｜
  [4] 🔊 试听有问题（指出段）→ 重跑 tts --part n ｜ [5] ❌ 取消（改走 reject 或暂不发布）

```bash
pnpm editor publish <id> --title "…" [--description "…"] [--tags a,b] [--language zh]
  [--guest claude] [--cover cover.jpg] [--audio final.m4a]
pnpm editor reject <id> --reason "拒审原因（必填，投稿人可见）"
```

### ⑧b 重新生成已发布节目（republish：重做后更新，链接/期号不变）

```
用户: "重新生成第 N 期" / 给 episodeId / 给节目链接
  ↓ ① 会话初始化 ② pnpm editor episodes [--match "关键词|期号"] 定位节目
  ↓ ③ pnpm editor detail <submissionId>（确认原始对话/采样仍在；drafts/<id>/dialogue.json 可复用，
  │     内容来源变化则先 fetch 刷新）
  ↓ ④ 重跑生成工作流（与首期相同，可带修订指令）：1.1 选题 → 选题确认门 → 1.2 草稿 → 草稿确认门
  │     → 1.3 终稿 → 终稿确认门
  ↓ ⑤ tts → ⑥ merge（试听）→ **语音确认门（试听通过）** → ⑦ cover（Read 展示）
  ↓ ⑧ 阶段 2：2.1 元数据生成（metadata.json）→ 2.2 发布确认门（元数据+封面+试听）
  ↓ ⑨ pnpm editor republish <episodeId> --title "…" [--cover cover.jpg] [--tags a,b] [--guest <platform>]
  ↓ ⑩ 汇报：期号/链接不变，内容已更新
```

要点：**不是新建期**——期号/slug/播放统计/收藏/精选保留，仅内容字段替换；publishedAt 刷新（列表前移，
ETag 变化客户端重新拉取）；**republish 幂等**（重复调用只覆盖内容不产生重复期，重试安全——先确认
目标 episodeId 正确）；无 cover 时保留旧封面；确认门照旧（阶段 1 三个确认门：选题/草稿/终稿 + 阶段 2 发布确认门：元数据+封面+试听）；
服务端不自动通知投稿人（重做是内部动作）。

## 批量处理（批量过滤器 → 选号 → 制作流水线）

```
① pnpm editor batch [--limit N]（并发提取，已提取跳过）→ 分组展示（✅/❌/⚠️ + url + email）
   → 处置选号：[1] ✅ 组保留进自动生成 ｜ [2] ❌/⚠️ 组拒审（batch-reject）｜ [3] 人工处理 ｜ [4] 跳过
② ✅ 组自动生成（无询问，子代理执行——每个投稿一个 dailog-select + dailog-draft + dailog-polish，
   可并发；子代理直接写盘，主会话只收校验摘要）：
   · 1.1 → pass：写 selection.json（无人工选号，自动取推荐思路 ideas[0] 写入 chosen-idea.json）；
     reject：写 quality.json {pass:false, reason}
   · 1.2+1.3 连续执行 → 写 script-draft.json + script.json（元数据在 produce 阶段生成）
③ pnpm editor batch-scripts → 分组呈现（已生成/质量不过关/待生成）
   → 处置选号：[1] ✅ 已生成脚本保留，进入阶段 2 ｜ [2] ❌ 质量不过关拒审（batch-reject）｜
              [3] 人工处理 ｜ [4] 跳过
④ 用户选号：pnpm editor produce --ids <id1,id2,...> [--language zh] [--guest <platform>]
   → 逐个自动：tts（逐段）→ merge（intro/outro 按语言）→ cover（**produce 不含元数据生成**）
   → 输出：final.mp3/final.m4a 路径 + 节目信息草稿（标题）
⑤ 内容核查（进 tts 前必做）：对照 selection.json 的 fact_check_list 逐条核实（无法核实 → 删除断言）
   与 privacy_redactions（逐条确认已泛化）——核查不通过 → 返回 1.3 修改脚本，不进 tts
⑥ 确认点① 语音预览（**顺序红线：2.1 元数据生成必须在此之后**）：merge 已自动 QuickTime 试听 →
   [1] ✅ 试听通过 → 进 2.1 元数据生成 ｜ [2] 🔊 哪段有问题 → 重跑 tts --part n → 重新 merge 试听
⑦ 2.1 元数据生成（dailog-meta → metadata.json，仅对试听通过者）
⑧ 发布确认门（确认点②）：metadata.json 逐项（标题/简介/摘要/标签/**references**/金句）+ **封面（Read 展示）**→
   [1] ✅ 确认发布 ｜ [2] ✏️ 改元数据 ｜ [3] 🎨 重做封面 ｜ [4] ❌ 取消
⑨ pnpm editor publish <id> --title "..." [--summary ...] [--cover ...] [--tags ...] [--references-file <json>]
   → 发布成功：状态 → published + 站内通知 + 邮件 + 草稿自动清理
```

**要点**：机器批量跑（提取并发 → 脚本自动生成 → produce 流水线），人工只在两级决策点 + 两个确认点介入。

## 播放列表（平台策展）

```
pnpm editor playlist list | create "<标题>" [--desc] [--picked] [--private]
pnpm editor playlist episodes <id> | add <id> <episodeId|#期号> | remove <id> <episodeId>
pnpm editor playlist reorder <id> <id1,id2,...> | pick/unpick <id> | public/private <id> | delete <id>
pnpm editor playlist cover <id> [--texture ...] [--colors ...] [--image-url <URL>]
```

- 封面复用单集 cover 引擎 → 上传 R2（sharp 归一 1400²）；无自定义封面前端自动取首期封面
- 节目引用支持 #期号；收录仅限已发布公开节目；删除级联清理条目

## 进度与恢复（会话中断不丢）

每命令完成自动写 `drafts/{id}/progress.json`。新对话恢复：① 会话初始化 → ② `pnpm editor progress
<submissionId>`（进度 + 下一步 + 产物清单）→ ③ 按提示继续（已有产物自动跳过重复步骤）。

## 草稿目录（gitignored）

`.dailog-editor/drafts/{submissionId}/`：dialogue.json / selection.json / chosen-idea.json /
script-draft.json / script.json / metadata.json / 分段音频 / final.m4a / 封面。**发布成功后自动清理语音/封面文件**
（publish 完成即删该投稿的 *.mp3/*.wav/*.webm 与 *.jpg/*.jpeg/*.png）；对话/脚本等文本草稿保留可重做。

## 工具链要点（详细运维记忆见 `reference/toolchain-notes.md`）

- **detail 含主持人称呼与画像**：`callName`（脚本开场自我介绍用，替换 {主持人称呼}，无则「主持人」；
  脚本语言与称呼语言不同时按 polish.md 检查清单 11 转写，如 飞→Fei）与 `personaInfo` 快照
- **采样匹配（服务端自动）**：TTS 按脚本语言取采样 → 无则英文 → 无则最近一条兜底；detail 返回
  voiceSamples 列表（全部语种）
- **publish 无响应 ≠ 失败**：服务端同步端点，受限网络下响应可能被邮件挂死——先 `detail/list` 查状态，
  published 即成功，勿重试
- **multipart 上传必须走 serializeFormData**（lib.ts 已接上；改上传端点时别把 formData 直接当 body）
- **本地环境存储是 R2**：发布产物在 R2 不在宿主机 data；重发同投稿覆盖旧音频但 episode 行每次新建
  （publish 非幂等；republish 幂等）
- **pnpm EPERM（DSH）**：根 .npmrc 已加 manage-package-manager-versions=false；仍报错直调
  `node .agents/skills/dailog-editor/scripts/run.js`
- 其余（代理探测 / chatgpt SSR 解码 / 测试红线 / 本地容器 R2 代理 / local 端口等）：见
  `reference/toolchain-notes.md`

## 红线

1. **不伪造内容**：网页拉取失败/内容无法提取 → 如实汇报，不凭猜测生成脚本
2. **脚本必须符合 dailog 标准**：开场轻量结构（问候 + 自我介绍 + 引出嘉宾，双方称呼不可变）、
   核心对谈 10 分钟内、1.1 选题筛选通过（时刻门含问题归位测试 + 逻辑骨架 + 价值维度）、提问保真
   （原生提问 ≥50%、含义不歪曲）与角度保真（话题角度 = 用户呈现意图，节目建议为锚，
   polish.md 铁律 6）；无时刻/骨架断裂/任务型对话 → 拒审
3. **脚本确认门**：生成后必须给编辑确认（终稿确认门默认在回复正文展示完整脚本全文 + 优化总结），
   选项编号收口，未确认不进 tts；配套产物（元数据）在阶段 2 发布确认门与封面/试听一并确认，未确认不发布
4. **发布前必须试听**（merge 自动 QuickTime）：音色克隆异常/断句错误/情绪标签未生效 → 修好再发
5. **发布/拒审是外发动作**：先与编辑确认（标题/封面/拒审原因，选项编号收口），确认后一次执行；
   **republish 同样是外发动作**——必须先试听 + 编辑确认
6. **拒审原因必填且具体**：投稿人可见，邮件也会发送——写清楚为什么
7. **密钥/token 不出本地**：.dailog-editor/.env 与 session.json gitignored + chmod 600；汇报不打印
   token/key；登录走浏览器授权
8. **内容核查**：进 tts 前必须对照 fact_check_list 核实事实（无法核实 → 删除断言）与
   privacy_redactions（逐条确认已泛化）——未核查不进 tts、不发布
9. **呈现通道**：所有面向编辑的展示必须在 agent 回复正文（脚本全文单个 code block、封面 Read 直出），
   **禁止用工具输出承载展示**；子代理 JSON 直接写盘，主会话不打印全文
