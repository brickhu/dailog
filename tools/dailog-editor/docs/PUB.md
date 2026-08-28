# PUB 发布（Publish）

> **索引**：主文档 `SKILL.md`（定义/触发见主文档）｜ 步骤 PUB-STEP-1..3 ｜ 确认门 PUB-GATE-1（=PUB-STEP-3）｜
> 节码 PUB-FLOW / PUB-IN / PUB-GATE / PUB-OUT / PUB-ERR
> 前置：TTS-GATE-1 语音确认通过（final.m4a 就绪）｜ 拒稿：见 REJ

**PUB-FLOW 流程 / 原则 / CLI 调用逻辑**
```
PUB-STEP-1 封面：pnpm editor cover <id> [--texture ...] [--colors "#hex,#hex"] [--guest <platform>] [--image-url <URL>]
  · 默认：纹理指令预置库随机（无 Pexels 依赖）→ 1400×1400 JPEG；居中「主持人称呼 × 嘉宾称呼」（超宽自动缩字号）
  · 不满意 → --image-url <URL>（下载裁切）；生成后立即把封面图 Read 展示给编辑
PUB-STEP-2 元数据：子代理 dailog-meta（模板见 reference/subagent-templates.md），读取 prompts/meta.md + script.json（终稿）
  + chosen-idea.json（含 role_block）→ 生成 title/summary/description/tags/coverKeywords/category/references/highlights → metadata.json
  · 基于终稿：金句逐字来自终稿 segments；脚本修改（重跑 SC-STEP-2）后须重跑本步
PUB-STEP-3 发布确认门（PUB-GATE-1）：元数据 + 封面 + 试听一并确认 → publish / reject
```
```bash
pnpm editor publish <id> --title "…" [--description "…"] [--tags a,b] [--language zh]
  [--guest claude] [--cover cover.jpg] [--audio final.m4a]
pnpm editor reject <id> --reason "拒稿原因（必填，投稿人可见）"
```
原则：**前置红线**——发布必须在 TTS-GATE-1 语音确认门通过后开始（语音未确认时元数据生成属浪费且顺序违规）；
references 外链不编造（链接安全红线）；发布/拒稿是外发动作，先确认后一次执行。

**PUB-IN 输入规范与依赖**
- 输入：`final.m4a`（TTS-STEP-2 产物）、`script.json`（终稿）、`chosen-idea.json`（含 role_block；PUB-STEP-2 从终稿 segments 识别新概念生成 references，不读对话原文）
- 产物 metadata.json：publish 自动读取（description/highlights/category/summary；旧草稿 fallback script.json）
- 依赖：语音确认门通过；--description/--tags 可覆盖，与最终 title/category 不匹配则重生成一版再确认

**PUB-GATE 确认门选项与输出模板**
发布确认门（PUB-GATE-1）：
- 展示（回复正文）：**metadata.json 全部字段逐项列出**（标题 / 简介 / 摘要 / 标签 / 分类 / 金句 / references——
  references 外链须人工确认无编造）+ **封面图 Read 直出** + 试听确认（merge 已自动打开 final.m4a）——不要只给标题+封面
- 交互（统一选号格式，见 RULES-10，一项一行）：
  `[1] : ✅ 确认发布`
  `[2] : ✏️ 改元数据（附说明）` → 重跑 PUB-STEP-2
  `[3] : 🎨 重做封面`
  `[4] : 🔊 试听有问题（指出段）` → 重跑 tts --part n
  `[5] : ❌ 取消`（改走拒稿见 REJ 或暂不发布）
输出模板（metadata.json 字段）：title / summary / description / tags / coverKeywords / category / references / highlights

**PUB-OUT 输出物存放与命名标准**
`drafts/{submissionId}/metadata.json` + 封面 jpg。**发布成功后自动清理语音/封面文件**（publish 完成即删该投稿的
*.mp3/*.wav/*.webm 与 *.jpg/*.jpeg/*.png）；对话/脚本文本草稿保留可重做；发布产物在服务端 R2。

**PUB-ERR 错误处理**
- **publish 无响应 ≠ 失败**：服务端同步端点，受限网络下响应可能被邮件挂死——先 `detail/list` 查状态，published 即成功，勿重试
- references 疑似编造 → 人工确认，不确定一律不给
- --description/--tags 与最终 title/category 不匹配 → 重生成一版再确认
- 拒稿 → `reject <id> --reason "…"`（必填），见 REJ
