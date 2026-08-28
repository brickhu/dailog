# BATCH 批量流水线（跨能力自动化）

> **索引**：主文档 `SKILL.md`（附录索引）｜ 步骤 BATCH-STEP-1..9 ｜ 复用门：TTS-GATE-1 + PUB-GATE-1
> 跨能力：CL-STEP-3 批量采集 / SC-STEP-1..2 自动生成 / TTS + PUB produce 流水线

机器批量跑（批量采集 → 批量脚本 → produce 流水线），人工只在两级决策点 + 两个确认门介入。

```
BATCH-STEP-1 pnpm editor batch [--limit N]（并发采集，已提取跳过）→ 分组展示（✅/❌/⚠️ + url + email）
   → 处置选号（统一选号格式，见 RULES-10，一项一行）：
     [1] : ✅ 组保留进自动生成
     [2] : ❌/⚠️ 组拒稿（batch-reject，见 REJ）
     [3] : 人工处理
     [4] : 跳过
BATCH-STEP-2 ✅ 组自动生成（无询问，子代理执行——每个投稿一个 dailog-select + dailog-draft，可并发）：
   · SC-STEP-1 → pass：写 selection.json（无人工选号，自动取推荐思路 ideas[0] 写入 chosen-idea.json）；
     reject：写 quality.json {pass:false, reason}
   · SC-STEP-2 脚本生成（内容 + 听感）→ 写 script.json（元数据在 produce 阶段生成）
BATCH-STEP-3 pnpm editor batch-scripts → 分组呈现（已生成/质量不过关/待生成）
   → 处置选号（统一选号格式，见 RULES-10，一项一行）：
     [1] : ✅ 已生成脚本保留，进入发布
     [2] : ❌ 质量不过关拒稿（batch-reject）
     [3] : 人工处理
     [4] : 跳过
BATCH-STEP-4 用户选号：pnpm editor produce --ids <id1,id2,...> [--language zh] [--guest <platform>]
   → 逐个自动：tts（逐段）→ merge 合成（final.m4a）→ cover（produce 不含元数据生成）
   → 输出：final.m4a 路径 + 节目信息草稿（标题）
BATCH-STEP-5 内容核查（进 tts 前必做，见 RULES-8）：对照 selection.json 的 fact_check_list 逐条核实（无法核实 → 删除断言）
   与 privacy_redactions（逐条确认已泛化）——核查不通过 → 回跳 SC-STEP-2 重生成，不进 tts
BATCH-STEP-6 语音确认门（TTS-GATE-1，顺序红线：PUB-STEP-2 元数据生成必须在此之后）：合成完成自动 QuickTime 试听 →
   [1] : ✅ 试听通过 → 进 PUB-STEP-2 元数据生成
   [2] : 🔊 哪段有问题 → 重跑 tts --part n → 重新合成试听
   （批量子集：封面重做已前置到 produce，故无 TTS-GATE-1 的 [3] 选项）
BATCH-STEP-7 PUB-STEP-2 元数据生成（dailog-meta → metadata.json，仅对试听通过者）
BATCH-STEP-8 发布确认门（PUB-GATE-1）：metadata.json 逐项（标题/简介/摘要/标签/references/金句）+ 封面（Read 展示）→
   [1] : ✅ 确认发布
   [2] : ✏️ 改元数据
   [3] : 🎨 重做封面
   [4] : ❌ 取消（改走拒稿见 REJ）
   （批量子集：试听问题重跑已前置到 BATCH-STEP-6，故无 [4] 试听选项、取消为 [4]）
BATCH-STEP-9 pnpm editor publish <id> --title "..." [--summary ...] [--cover ...] [--tags ...] [--references-file <json>]
   → 发布成功：状态 → published + 站内通知 + 邮件 + 草稿自动清理
```
