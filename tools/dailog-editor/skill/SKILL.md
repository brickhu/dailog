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

**本质版架构**：用户只提交 URL + 声音采样 → 落库待审核；编辑在本地 Agent 完成
内容拉取、脚本、语音、合成、封面，成品一次性上传发布。服务端不做任何采集/生成。

```
用户投稿（site）: URL（合法性+触达性检查）+ 采样 → submissions(status=submitted)
编辑（本技能）: list → detail → fetch 采集解码 → 生成脚本 → tts → merge
              → cover → publish（published + 通知投稿人）/ reject（拒审 + 通知）
```

## 前置条件

- `.dailog-editor/.env`（Fish/Pexels 密钥）与 `.dailog-editor/envs.json`（**环境清单**，
  模板 `tools/dailog-editor/templates/envs.example.json`）已配置
- 本机有 `ffmpeg` / `ffprobe`（采样转码 + 合成）；草稿目录 `.dailog-editor/drafts/` 自动创建
- 命令入口：`pnpm editor <cmd>`（根目录）；源码 `tools/dailog-editor/`

## 工作台概要（dailog / overview 直接触发）

用户说「dailog」「overview」「概要」等时——**直接展示工作台概要**（不进入完整流程）：

```
① 会话初始化（选环境 → auth-status，未配对先引导 login）
② pnpm editor overview → 展示：
   环境：<site_url>
   编辑：<email>
   1. N 条待审批；            ← 服务端 submitted 队列
   2. N 条脚本待生成语音；     ← 草稿有 script.json 未合成
   3. N 条语音待发布；         ← 草稿有 final.mp3 未发布
   4. N 条下线申请；           ← 用户「申请下线」→ 编辑审批（removal 队列）
   请问你接下来想处理什么？
③ 根据用户答复进入对应流程（批量处理 / 审核单个 / 制作 / 发布…）
```

## ⚠️ 会话初始化（每个新对话必做——环境与配对是会话级状态）

**环境选择与配对不落全局配置**：每次新起对话，先确认环境与授权，再开始操作；
新开对话必须重新确认（不沿用上次对话的选择）。

```
新对话开始（用户请求编辑操作）
  ↓ ① 列出环境清单（读 .dailog-editor/envs.json）→ 询问用户本次访问哪个环境
  │    （若用户已直接指定 → 用它；否则必须问，不默认）
  ↓ ② 检查该环境：pnpm editor --env <环境> auth-status
  │    · 先打 /health 验证端点可用（不可达 → 换环境/查网络，不继续）
  │    · 再查授权：✅ 有效 → 记下环境名，本对话后续命令全部带 --env <环境>
  │    · ❌ 未配对 / token 失效 → 引导配对（③）
  ↓ ③ 配对码登录：pnpm editor --env <环境> login
  │    终端给授权链接（API 域内自包含授权页，不依赖 site）→ 浏览器打开登录
  │    （已登录略过）→ 页面显示配对码 → **把码贴回对话** → 用
  │    pnpm editor --env <环境> login --code <配对码> 完成配对 → 成功
  │    （token 绑定该环境缓存本地；非交互环境不会自行抓码，见下「配对交接」）
  ↓ ④ 固化到当前对话：本对话所有 `pnpm editor` 命令显式带 --env <环境>
  │    （或导出 DAILOG_ENV=<环境> 作为本对话的环境变量）
  ↓ ⑤ 新开对话 → 回到 ① 重新确认环境 + 检查授权
```

要点：
- **环境必须显式**：存在多个环境时命令不带 --env 会列出清单拒绝执行——防「以为是 dev 实际打到 prod」
- **每次对话首次调用先确认端点可用**：`auth-status` 第一步打 `/health`（无鉴权）——
  端点不可达与未授权分开提示，避免「连不上还去配对」的误导
- **token 绑定环境**：dev 的 token 不能用于 prod（会提示先配对 prod）
- **配对交接（非交互 harness）**：`pnpm editor login` 在非交互环境只创建授权并打印
  授权 URL 后即返回，**绝不自行抓取/读取配对码**（页面上的配对码在本机名浏览器登录态下，
  CLI 拿不到，也不该拿）。正确做法：创建授权 → 把 URL 给编辑在浏览器打开 → 编辑把页面
  显示的配对码**贴回对话** → agent 用 `pnpm editor --env <环境> login --code <配对码>`
  提交配对（复用已创建授权，无需重开/重授权）。**红线**：不得自行 GET/访问授权页或任何
  端点去"偷"验证码，也不得伪造/编造配对码，必须等编辑回贴。
- 用户中途说「换个环境」→ 重新走 ①-④（login 可用 `--force` 重配对）

## 工作流（一条龙）

```
用户: "审核投稿" / 给 submissionId / 粘贴 URL
  ↓ ① 会话初始化（见上：确认环境 → auth-status → 必要时配对）
  ↓ ② 拉取队列或详情
  ↓ ③ 采集 + 内容解码：pnpm editor fetch <id>（拉取 URL → page.html/page.txt/dialogue.json）
  │    结构化命中直接用 dialogue.json；未命中 → 浏览器/控制台兜底后提炼
  ↓ ④ 三步制作：Step A 选题筛选（selection.md）→ pass 写 selection.json / reject 写 quality.json；
  │        Step B1 内容结构（script-draft.md）→ script-draft.json；
  │        Step B2 听感打磨（script-craft.md）→ script.json；进 tts 前内容核查（fact_check_list /
  │        privacy_redactions，见阶段 2 ⑤）
  ↓ ⑥ pnpm editor tts <id> --script script.json --language <lang>  （逐段合成）
  ↓ ⑦ pnpm editor merge <id> --language <lang>                      （合成 final.mp3，intro/outro 按语言匹配）
  ↓ ⑧ pnpm editor cover <id> [--guest <platform>]                      （本地模板封面，居中「主持人 × 嘉宾」称呼）
  ↓ ⑨ 与编辑确认 → pnpm editor publish <id> --title "…" …             （一次性上传发布）
  ↓    或 pnpm editor reject <id> --reason "…"                         （拒审）
  ↓ ⑩ 汇报：期号/节目链接 或 拒审原因
```

> 本工作流中所有 `pnpm editor` 命令均带会话选定的环境（`--env <环境>` 或 `DAILOG_ENV`），下文为简洁省略。

### ② 队列与详情

```bash
pnpm editor list                  # 待审队列（先到先审；⚠️无采样 = 无法克隆主持人音色）
pnpm editor detail <submissionId> # URL/投稿人/主持人称呼(callName)/节目建议/采样 transcript/已上线节目
                                  # （采样在服务端 R2，无需下载本地）
pnpm editor removal               # 节目下线申请队列（用户申请 → 编辑审批；approve 下架+通知，reject 拒绝+通知）
```

### ③ 采集 + 内容解码（`pnpm editor fetch <id>`）

- 命令：`pnpm editor fetch <id>` → 拉取投稿 URL 并解码落盘草稿目录：`page.html`（原始 HTML）/
  `page.txt`（清洗后正文）/ `dialogue.json`（`[{role: "user"|"assistant", content}]`）
- 平台分派 / 代理兜底 / 提取策略 / 浏览器兜底步骤 / 解码规则自进化 / 平台经验库：
  **详见 `reference/fetch-decoding.md`**
- 拉取失败（403/超时/失效）→ 如实汇报，引导用户走浏览器控制台兜底
  （console-script/paste 步骤见 reference）

### ④ 三步制作流程（选题 → 内容结构 → 听感打磨）

用 LLM（本环境任意可用模型）按两级流程把对话做成**朗读向播客脚本**，两个提示词文件独立：

**Step A · 选题筛选（`prompts/selection.md`——批量质量检查环节）**
- 系统提示词 = selection.md **原样**；用户消息 = 对话原文（逐条）+ 节目建议（如有，角度锚点）。
- 输出选题 JSON：verdict（pass/reject）、dimension（认知/经验/建议/启发）、moment.quote
  （核心时刻原话）、spine_required（承重墙回合）、background_needed、arc、score（时刻强度分）、
  opening_question（用户开场自述的问题与动机）、suggestion_decision（节目建议取舍）等。
- pass → 选题 JSON 存 `drafts/{id}/selection.json`，**题材确认门**：向编辑展示选题思路
  （题材 + 为什么 + moment + 收获价值），确认后进入 Step B1；
  reject（G1-G5 / no_moment / no_spine）→ 拒稿，写 `drafts/{id}/quality.json {pass:false, reason}`
  （reason 取 reject.feedback，面向投稿人）。

**Step B1 · 内容结构（`prompts/script-draft.md`——内容确认门）**
- 系统提示词 = script-draft.md **原样**；用户消息 = selection.json + 对话原文。
- 输出内容结构 JSON：topic_confirm / harvest_summary / structure（②定向要点 + ③承重墙回合清单
  + moment 位置 + ④落点要点 + ⑤收束要点）→ 存 `drafts/{id}/script-draft.json`。
- **内容确认门**：向编辑展示 内容结构 + harvest_summary（收获价值总结，编辑参考）——
  确认结构/改结构后进入 Step B2。

**Step B2 · 听感打磨（`prompts/script-craft.md`——成品确认门）**
- 系统提示词 = script-craft.md **原样**；用户消息 = script-draft.json + selection.json + 对话原文
  + 修订指令（可选）。
- 只动**呈现层**（措辞/情绪/停顿/穿插/转场/节奏）；承重墙回合/moment 位置/角度以 script-draft
  为准（铁律 7 结构护栏）——结构反馈先回 Step B1，听感反馈只重跑本层。
- **现场感（Live Feel）红线**：脚本是「对话当时的剪辑」不是「重放」——开场禁止剧透结局、
  禁止倒叙腔/事后视角、禁止预知对话走向、禁止旁观评判腔、禁止回声附和腔（host 复读 AI 观点
  补"记住了/学到了"）、禁止自大腔（未做先宣称，详见 script-craft.md 铁律 5）。
- 输出脚本 JSON：language/title/topic/summary/description/tags/coverKeywords/category/references/
  creationNote/segments（含 part）→ 存 `drafts/{id}/script.json`。

> **提示词保真**：三个提示词文件均**原样**作为 LLM 系统提示词，不要自己改写压缩
> （压缩会丢细节导致读稿感/漏判）。
> **投稿人节目建议（角度锚点）**：detail 的「节目建议」是投稿人可选填写的**用户呈现意图（A）
> 的最强信号**——投稿人明确写出的角度/主题/想分享什么，Step A 必须以它为角度约束
> （时刻与骨架须落在建议指向的路径上，见 selection.md 步骤 0/2）；与时刻门硬冲突时按质量
> 闸门取舍，并把取舍写进 selection.json 的 suggestion_decision。有 → 追加到 Step A 用户消息
> 末尾；Step B 不再重复处理，但输入含 suggestion_decision，脚本角度不得偏离（铁律 6）。

**1. 语言**：跟随原对话主要语言（zh/en/ja/ko…）

**2. 时长**：核心对谈 10 分钟内（≤约 2800 字；上限由 Fish Audio 多说话人接口时长上限决定，这也是分段合成 --parts 的意义）——开场+自述与落点+收束不计入（框架节拍保持轻），压缩长段落、去除冗余

**3. 朗读向**：多用短句、自然断句，避免书面语和长修饰（"此外""综上所述"），标点控制朗读节奏

**4. 真人对话感（细则已并入 script-craft.md）**：留白/穿插/比喻/打断/调侃/隐私模糊化/欢笑/
直播感/思考 九条细则已并入 `prompts/script-craft.md`（「情绪设计」+「临场思考」+ 听感检查
清单 5/8/11）——以 prompt 文件为准。

**5. 开场白（轻量结构，见 script-craft.md）**：开场白只保留 问候 + 自我介绍 + 引出嘉宾 三个
信息点（host/guest 两段），**不介绍 dailog 的用途**（节目名带过即可），切入方式按话题自由
设计；称呼改写规则（英文原样；中文等小语种 → 拼音/罗马字）见 `prompts/script-craft.md`
检查清单 11（五拍框架 ①）；主持人称呼 callName / 嘉宾名 guests 表 / 画像 personaInfo 的取用
见本技能「工具链已知点」与 ⑤ TTS。

**6. 切题与提问保真**：主题单元切分与拆期见 `prompts/selection.md` 步骤 2；提问保真
（原生提问 ≥50%、含义不歪曲、改写只动措辞不动含义）见 `prompts/script-craft.md`
铁律 2 与检查清单 10。

**7. 情绪标注（标签清单见 script-craft.md）**：情绪标注语法与 Fish S2 标签全表（基础/进阶/
语气/音效/停顿/组合/强度修饰）以 `prompts/script-craft.md`「情绪设计」为准。

**8. 元数据（见两个 prompt 输出）**：title/topic/summary/description/tags/coverKeywords/
references/highlights/category（insight/experience/advice/inspiration，由选题维度映射）
见 `prompts/script-craft.md`「配套产物」；creationNote（含选题依据与节目建议取舍）见
`prompts/selection.md` 输出 JSON。

#### 提示词文件（独立参照，三级）

生成时使用**独立提示词文件**——内容**原样**作为 LLM 系统提示词（对话原文作为用户消息），
不要自己改写压缩（压缩会丢细节导致读稿感）：

- **Step A 选题筛选**：`prompts/selection.md`
  （产物 `.agents/skills/dailog-editor/prompts/selection.md` / 源码 `tools/dailog-editor/prompts/selection.md`）
  ——硬性闸门 G1-G5 + 时刻门（含问题归位测试：时刻须落在用户意图路径上）+ 逻辑骨架 +
  价值维度 + 时刻强度分，输出选题 JSON（含 opening_question / suggestion_decision）
- **Step B1 内容结构**：`prompts/script-draft.md`
  （产物 `.agents/skills/dailog-editor/prompts/script-draft.md` / 源码 `tools/dailog-editor/prompts/script-draft.md`）
  ——五拍结构落位 + 承重墙回合清单 + moment 位置 + 收获价值总结，输出内容结构 JSON
- **Step B2 听感打磨**：`prompts/script-craft.md`
  （产物 `.agents/skills/dailog-editor/prompts/script-craft.md` / 源码 `tools/dailog-editor/prompts/script-craft.md`）
  ——情绪设计 + 临场思考 + 话题转移 + 确认性穿插 + 结构护栏（铁律 7）+ 配套产物，输出脚本 JSON
- `prompts/script-generation.md`：弃用，勿用（以 selection/script-draft/script-craft 三级为准）

#### 三步确认门（选题 → 内容结构 → 成品，逐关确认）

```
三关逐关确认，任何一关打回即重跑对应步骤；全部通过才进 tts：
  ① 题材确认门（Step A pass 后）：
     · 展示选题思路：题材 + 为什么值得做（moment / dimension / title_draft / 收获价值）
     · 编辑：✅ 确认 → 进内容结构；❌ 拒稿 → 走 reject 流程
  ② 内容确认门（Step B1 后）：
     · 展示 script-draft.json：内容结构（②定向 / ③承重墙回合清单 / moment 位置 / ④落点 / ⑤收束）
       + harvest_summary（收获价值总结，编辑参考）
     · 编辑：✅ 确认 → 进听感打磨；✏️ 改结构（换角度/切主题/加删回合）→ 回 Step B1 重跑
  ③ 成品确认门（Step B2 后）：
     · 成品脚本装进单个代码块整篇呈现（编号 + 说话人 + 情绪标签 + 停顿 + 完整文本，逐行通读）
     · 配套产物一并展示：title / summary / description / tags / coverKeywords / category /
       references / highlights——references 外链须人工确认无编造（链接安全红线）
     · **现场感检查**：开场无剧透结局、无倒叙腔/预知走向/旁观评判/回声附和、落点无"今天聊完"式
       完成态回顾（对照 script-craft.md 铁律 5）——编辑可凭「这段像不像正在发生的对话」判断；
       发现重放腔/复读腔 → 打回重生成
     · **角度保真检查**：开场定向是用户原话的含义、时刻是用户问题的答案、落点是用户自己的认识
       （对照铁律 6 投稿人测试）——投稿人听完应能说「这就是我那段对话」，认不出 → 打回重生成
     · **结构对照检查**：承重墙回合/顺序/moment 位置与 script-draft.json 一致（对照铁律 7）
     · **转场检查**：话题切换有由头（被触发/递进/补足/处境关联），无裸问、无「后来我又想」式
       万能过渡词（对照 script-craft.md「话题转移」节）——生硬 → 打回重生成
     · 编辑：✅ 确认 → 进入 tts；✏️ 听感反馈（情绪/停顿/穿插/转场）→ 只重跑 Step B2；
       ✏️ 结构反馈 → 回 Step B1
```

**红线**：脚本未经三步确认门全部通过不得进入 tts 合成——脚本是节目内容核心
（说什么/怎么说/称呼/时长），编辑把关后才能生成语音。
**展示要求**：确认环节必须给编辑看**完整脚本全文**（非预览摘要）——编辑说
「把脚本展示出来我看看」即此环节漏做，直接补全文展示（单个代码块整篇呈现）。

### ⑤ TTS（`pnpm editor tts <id> --script script.json [--language zh|en] [--guest <platform>]`）

- **整集一次合成（multi speaker——Fish 官方多说话人接口，默认）**：完整脚本 JSON 提交服务端
  `POST /v1/editor/tts`，服务端组装 `<|speaker:0|>`（host）`<|speaker:1|>`（guest）标签 +
  references 2D 零样本克隆（host 采样 + guest 声线）→ 一次调用返回整集 mp3（`full.mp3`）
- **三段落合成（`--parts`，推荐）**：脚本按 part 字段分 3 段独立合成（script-craft 生成时标注：
  part1=开场+定向、part2=对谈、part3=落点+收束）→ 每段一次请求（part1/2/3.mp3）→ 拼接
  `full.mp3`（段间 0.6s 静音）。好处：单段输入更短（长稿质量更稳）、某段音色/情绪有问题只重跑
  该段（`--part <n>`）不重跑整集（省配额与时间）
- `--part <1|2|3>`：只重跑某一段（part{n}.mp3）→ 自动与已有段落重新拼接 full.mp3
- **统一走服务端端点**——编辑本地不直连 Fish Audio，**Fish key 只配在服务端**
  （Railway env），编辑无需任何 TTS 密钥
- host（主持人）= 投稿人采样：服务端从投稿人记录取用（R2 + 表内转录）
- guest（AI 嘉宾）= **声线在服务端配置**（guest_voice_samples 表 + R2）：
  - `--guest <platform>` 指定嘉宾（claude/chatgpt/deepseek/gemini/kimi/doubao/tongyi/perplexity）
  - 服务端按 guestId + 语言取声线（同语种优先 → 兜底任意语种）；未配置 → 422 提示先上传
  - 查看嘉宾与声线状态：`pnpm editor guests`（管理入口）
  - 声线管理：`pnpm editor guest-voice <guestId> --audio <file> [--language zh] [--transcript "..."]`
  - 嘉宾称呼/简介（节目中的称呼）也在服务端：`pnpm editor guest-set <guestId> --name "..." [--intro "..."]`
- 纯 host 脚本（无 guest 段）→ 服务端 single 整集合成；含 guest → multi speaker
- 产物：`full.mp3`（整集）→ 下一步 merge（intro + full + outro）
- 失败：汇报错误（服务端 Fish 余额/限流/超时），按提示重跑该段（--part n）或整集

### ⑥ 合成（`pnpm editor merge <id> [--language zh|en]`）

- **intro/outro 统一自动匹配节目语言**：`tools/dailog-editor/assets/intro.{lang}.mp3` / `outro.{lang}.mp3`
  ——语言专属缺失自动 **fallback 通用资产** `intro.mp3` / `outro.mp3`；都缺失则警告跳过
- 段间自动插 0.6s 静音；`--intro/--outro` 可显式指定本地文件临时替换
- 产物 `final.mp3` + 时长/大小；`open final.mp3` 试听（**发布前必须试听**：音色/断句/情绪标签是否正常）

### ⑦ 封面（本地方案——默认模板渲染，不满意贴图 URL）

```
pnpm editor cover <id> [--texture squares|crosses|hexagons|woven|diagonal|zigzag] [--colors "#hex,#hex"] [--guest <platform>] [--image-url <URL>]
```

- **默认：从 riccardoscalco.it/textures 页面指令预置库随机选 1 条完整执行**（无 Pexels 依赖）：
  - 31 条页面指令全部收录（lines 13 / circles 10 / paths 8）：纹理 + 密度（heavier/lighter/size）+
    线宽（thicker/thinner/strokeWidth）+ 颜色（darkorange/firebrick）按指令一起随机
  - 无指令指定颜色时：先定底色（深色池随机）→ 纹理色选**色相差 ≥120°**（鲜明对比）
  - 布局：纹理中间 80%（四周 10% 留白），单块尺寸按容器整除（边缘吻合）
  - 渲染：渐变底色 + pattern 纹理 + 噪点 → resvg → 1400×1400 标准 JPEG
  - 固定复现：`--texture <名> --colors "<底色>,<纹理色>"`（日志会给出当前指令与组合）
- **居中称呼（无外部图片时叠加）**：图片中心显示**主持人称呼 × 嘉宾称呼**（如 `Fei × Deepseek`）：
  - 主持人称呼 = 投稿 detail 的 callName（无则画像 displayName）；嘉宾称呼 = `--guest <platform>`
    对应 guests 表 name（无配置 → 平台展示名兜底；未传 --guest → 按投稿 URL 推断平台）
  - **文本区宽度不超过底纹区域**：超宽自动缩小字号（起始 120px，下限 32px）
  - **文字颜色按底色明暗**：底色偏黑 → 白字 60% 透明度；底色偏白 → 黑字 60% 透明度
  - 外部图片（--image-url）不叠加文字
- **编辑不满意** → 贴图片 URL：`pnpm editor cover <id> --image-url <URL>`（下载 → ffmpeg 裁 1400×1400）
- **生成后立即把封面图展示给编辑**（Read 图片直接呈现——确认环节也要再次展示）
- 发布时不传封面 → 播放页自适应（无封面）

### ⑧ 发布 / 拒审（与编辑确认后执行）

```bash
pnpm editor publish <id> --title "…" \
  [--description "…"] [--tags a,b] [--language zh] [--guest claude] [--cover cover.jpg] [--audio final.mp3]
# 成功后：episode 直接 published（期号 max+1），投稿人收到「dailog 第 N 期」通知+邮件
pnpm editor reject <id> --reason "拒审原因（必填，投稿人可见）"
```

**确认呈现要求**（确认点 ② 节目信息预览）：
- **封面图直接展示**（Read 图片呈现给编辑——不要只描述「已生成/什么颜色」）
- **分类**：自动从 script.json 读取（insight/experience/advice/inspiration，由选题维度映射）——确认无误后发布
- **description 定稿**：草稿来自 Step B（script.json，publish 自动带上，--description 可覆盖）——核对是否与最终
  title/category 匹配，不匹配则按最终信息重生成一版再确认（规格：2-4 句 80-150 字，钩子 + 上下文 +
  按分类的收获预告，不剧透时刻）
- 连同标题/简介/标签/嘉宾/时长一并列出，编辑确认后一次执行 publish

## 批量处理（批量过滤器 → 选号 → 制作流水线）

### 阶段 1：批量过滤器（提取 + 质量检查/脚本生成）

```
① pnpm editor batch [--limit N]（并发提取，已提取跳过）→ 分组展示（✅/❌/⚠️ + url + email）
   → 询问处置：✅ 组保留草稿进入自动生成；❌/⚠️ 组拒审（batch-reject，通知+状态）/人工/跳过
② ✅ 组自动三步处理（无询问）：
   · Step A 选题筛选（selection.md）→ pass：写 drafts/{id}/selection.json；
     reject：写 drafts/{id}/quality.json {pass:false, reason}
   · Step B1 内容结构（script-draft.md）→ 写 drafts/{id}/script-draft.json
   · Step B2 听感打磨（script-craft.md）→ 写 drafts/{id}/script.json
③ pnpm editor batch-scripts → 分组呈现（已生成/质量不过关/待生成）→ 询问处置
   · ❌ 质量不过关 → batch-reject（通知+状态）/ 跳过 / 人工
   · ✅ 已生成脚本 → 保留，进入阶段 2
```

**批量过滤器本质**：提取 + 质量检查/脚本生成滤出「合格脚本」——不达标的在两级决策点
（提取后、脚本后）由管理员处置，合格脚本汇聚成待制作清单。

### 阶段 2：选号 → 制作流水线（两个确认点）

```
④ 用户选号（从 batch-scripts 清单选编号/ID）：
   pnpm editor produce --ids <id1,id2,...> [--language zh] [--guest <platform>]
   → 逐个自动：tts（逐段）→ merge（intro/outro 按语言）→ cover（脚本 coverKeywords）
   → 输出：final.mp3 路径 + 节目信息草稿（标题）
⑤ 内容核查（进 tts 前必做）：对照 selection.json——
   · fact_check_list 逐条核实（无法核实的内容：从脚本删除该断言，或不下架）
   · privacy_redactions 逐条确认已在脚本中泛化处理
   核查不通过 → 返回 Step B 修改脚本，不进 tts
⑥ 确认点 ① 语音预览：open final.mp3 试听（音色/断句/情绪标签）→ 确认
⑦ 确认点 ② 节目信息预览：确认标题/summary/简介/标签/**references**/**封面（封面图直接 Read
   展示给编辑）**→ 确认发布
⑧ pnpm editor publish <id> --title "..." [--summary ...] [--cover ...] [--tags ...]
   [--references-file <json>]
   → 发布成功：投稿状态 → published + 站内通知 + 邮件（「dailog 第 N 期」）
   → 草稿自动清理（发布为终态）
```

**要点**：机器批量跑（提取并发 → 脚本自动生成 → produce 流水线），人工只在
两级决策点 + 两个确认点介入——每批一次决策，不逐个打断；发布成功自动完成
状态流转 + 通知 + 邮件 + 草稿清理。

### ⑨ 播放列表（平台策展）

> 平台把已发布节目打包成主题列表（首页横滑区 / /playlists / 节目页「收录于」）。
> 数据模型：`playlists`（kind=platform/user）+ `playlist_episodes`（position 有序）。

```
pnpm editor playlist list                                  # 平台列表清单（期数/精选/公开）
pnpm editor playlist create "<标题>" [--desc "..."] [--picked] [--private]
pnpm editor playlist episodes <playlistId>                 # 列表节目（id + /episode 链接）
pnpm editor playlist add <playlistId> <episodeId|#期号>     # 加节目（#N 按期号解析）
pnpm editor playlist remove <playlistId> <episodeId>       # 移除
pnpm editor playlist reorder <playlistId> <id1,id2,...>    # 重排（逗号分隔有序 id）
pnpm editor playlist pick <playlistId> | unpick <playlistId>   # 精选标记（首页/发现页露出）
pnpm editor playlist public <playlistId> | private <playlistId> # 公开/下架
pnpm editor playlist delete <playlistId>                   # 删除（级联清条目）
pnpm editor playlist cover <playlistId> [--texture ...] [--colors "#hex,#hex"] [--image-url <URL>]
```

- **封面**：复用本地模板渲染（与单集 cover 同一引擎）→ 直接上传服务端
  （R2 `covers/playlists/{id}.jpg`，sharp 归一 1400²）；无自定义封面时前端自动取首期节目封面
- 节目引用支持 **#期号**（如 `playlist add <id> #7`——从编辑端节目清单按期号解析）
- 收录节目仅限已发布公开节目（服务端校验）；列表删除/节目删除均级联清理条目

## 进度与恢复（会话中断不丢）

每个命令完成时自动写进度标记 `drafts/{id}/progress.json`（step + 时间）。对话中断/退出后，
**新对话直接恢复断点**：

```
① 会话初始化（选环境 → auth-status，token 仍在直接可用）
② pnpm editor progress <submissionId>   → 显示进度 + 下一步 + 草稿产物清单
③ 按提示继续：tts → merge → cover → publish（已有产物自动跳过重复步骤）
```

产物全部在草稿目录持久（对话 JSON/脚本/分段音频/final.mp3/封面），无需重做已完成的步骤；
**发布成功后语音/封面自动清理**（published 为终态——文本草稿保留）。

## 草稿目录（db-ops 风格，gitignored）

`.dailog-editor/drafts/{submissionId}/`：对话 JSON、脚本、分段音频、final.mp3、封面。
**发布成功后自动清理语音/封面文件**（`publish` 完成即删除该投稿草稿中的 `*.mp3/*.wav/*.webm`
与 `*.jpg/*.jpeg/*.png`——整集/合成/逐段语音与封面不留本地；对话/脚本/页面等文本草稿保留，
可查阅与重做；重做时重新 tts 即可）。

## 工具链已知点（维护记忆）

- **本地环境基址统一为 `http://localhost:8787`**（`api.dailog.orb.local` 已废弃）：
  `.dailog-editor/envs.json` 的 local 项 apiBase/siteUrl 均指向 localhost:8787（API/站点同端口）；
  纯 HTTP 走原生 fetch，`lib.ts` 中 `.orb.local` 的 TLS 忽略逻辑仅保留兼容旧地址。
- **代理探测**（`src/fetch.ts findSocksProxy`）：env `ALL_PROXY`/`HTTPS_PROXY`（含 socks）优先，
  其次 macOS `scutil --proxy`（SOCKSEnable+SOCKSPort）。走代理用 `curl --socks5-hostname`
  子进程（DNS 也过代理）——Node fetch/undici 原生不支持 SOCKS，别引入 socks 依赖重造。
- **chatgpt SSR 解码**（`src/fetch.ts decodeStreamTable`）：解码结构见 `reference/fetch-decoding.md`
  平台经验库 chatgpt 行——平台改版优先检查流式引用编码结构，别先改 DOM 规则。
- **multipart 上传必须走 `serializeFormData`**（`src/lib.ts`）：历史 `.orb.local`
  自签证书的 undici dispatcher 路径下原生 `FormData` 作 body 会失效——服务端收到空表单，
  publish/guest-voice 报 400 `audio_required`/`invalid_body`。`api()` 已接上自定义编码
  （字节流 + 手写 boundary + 显式 content-type）。**改 api()/加上传端点时别再把 formData
  直接当 body 传**——回归测试：multipart 请求后服务端能读到文件字段。
- **detail 已含主持人称呼与画像**：`getDetail` 返回 `callName`（submissions.call_name，投稿时配置、
  默认 displayName 可改）与 `personaInfo` 快照（displayName/性别/职业/年龄/国籍/bio），
  detail.ts 展示「主持人称呼」与「画像」行；脚本生成时用 callName 替换 {主持人称呼}，
  无则「主持人」。脚本语言与称呼语言不同时按 script-craft.md 检查清单 11 的称呼改写规则转英文形式（如 飞→Fei）。
- **采样匹配（服务端自动）**：TTS 按脚本语言取采样 → 无则英文采样 → 无则最近一条采样兜底；
  `detail` 返回 voiceSamples 列表（全部语种），供编辑确认。
- **测试红线**：`publish` 端点无 dry-run——curl/脚本直打真实 submission 就是真实发布
  （curl 探测把投稿发布成带测试元数据的期）。探测 multipart 用本地回环
  服务器解析结构，或打已 published 的投稿（状态检查在 formData 解析前，不污染数据）。
- **本地环境存储是 R2**：`services/api/.env.local` 为 `STORAGE_DRIVER=r2`——发布产物在
  R2 不在宿主机 `services/api/data`；`episodes/{userId}/{submissionId}.m4a|mp3` key 确定性，
  重发同投稿会**覆盖旧音频对象，但 episode 行每次新建**（publish 非幂等，见下条）。
- **publish 无响应 ≠ 发布失败**：publish 是同步端点，服务端在
  createPublished（期号+状态流转）之后才等 sendEmail——受限网络下 api.resend.com 不可达且原实现
  无超时，响应被邮件挂死；客户端超时被杀后重试会再建一期。已修复：sendEmail 加 10s 超时
  （`services/api/src/email/resend.ts`）；编辑侧 publish.ts 已加状态预检（非 submitted 拒绝）。
  遇 publish 无响应先 `pnpm editor detail/list` 查状态——published 即成功，勿重试。
- **本地容器 R2 代理是死配置**：`services/api/src/index.ts` 的 createStorage 未传 r2ProxyUrl，
  .env.local 的 R2_PROXY_URL 不生效；容器（OrbStack VM）直连 R2 可用（宿主直连才需代理）。
  改 storage 接线时别照抄 .env.local 的 127.0.0.1 代理——容器内应 host.docker.internal。
- **local 环境端口**：API localhost:8787（统一基址）/ 站点 localhost:3000（dailog 容器 80→3000）；
  envs.json 的 siteUrl 用于发布后节目地址展示。

## 红线

1. **不伪造内容**：网页拉取失败/内容无法提取 → 如实汇报，不凭猜测生成脚本
2. **脚本必须符合 dailog 标准**：开场轻量结构（问候 + 自我介绍 + 引出嘉宾，双方称呼不可变；
   不介绍 dailog 用途）、核心对谈 10 分钟内、Step A 选题筛选通过（时刻门含问题归位测试 + 逻辑骨架 +
   价值维度，四维：认知/经验/建议/启发）、提问保真（原生提问 ≥50%、含义不歪曲）与角度保真
   （话题角度 = 用户呈现意图，节目建议为锚，见 script-craft.md 铁律 6）；无时刻/骨架断裂/
   任务型对话 → 拒审
3. **脚本确认门**：生成脚本后必须**全文展示**给编辑确认（内容/时长/称呼/情绪），未确认不进 tts
4. **发布前必须试听**（open final.mp3）：音色克隆异常/断句错误/情绪标签未生效 → 修好再发
5. **发布/拒审是外发动作**：先与编辑确认（标题/封面/拒审原因），确认后一次执行
6. **拒审原因必填且具体**：投稿人 /me/submits 可见，邮件也会发送——写清楚为什么
7. **密钥/token 不出本地**：`.dailog-editor/.env` 与 `session.json` 均 gitignored + chmod 600；
   汇报中不打印 token/key；登录走浏览器授权（密码不落盘）
8. **内容核查**：进 tts 前必须对照 selection.json 的 fact_check_list 核实事实（无法核实 → 删除断言）
   与 privacy_redactions（逐条确认已泛化）——未核查不进 tts、不发布
