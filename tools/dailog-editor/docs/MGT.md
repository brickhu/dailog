# MGT 管理（Manage）

> **索引**：主文档 `SKILL.md`（定义/触发见主文档）｜ 步骤 MGT-STEP-1..3 ｜
> 节码 MGT-FLOW / MGT-IN / MGT-GATE / MGT-OUT / MGT-ERR
> 复用门：SC-GATE-1..2 + TTS-GATE-1 + PUB-GATE-1（见对应分册）

**MGT-FLOW 流程 / 原则 / CLI 调用逻辑**
```
MGT-STEP-1 重新生成（republish，重做后更新，链接/期号不变）：
  episodes [--match "关键词|期号"] 定位节目 → detail <submissionId> 确认原始对话/采样仍在
  （drafts/<id>/dialogue.json 可复用，内容来源变化则先 fetch 刷新）→ 重跑脚本两关（SC-STEP-1..2）
  → TTS（TTS-STEP-1..3）→ PUB-STEP-1 封面 → PUB-STEP-2 元数据 → PUB-GATE-1 发布确认门
  → pnpm editor republish <episodeId> --title "…" [--cover cover.jpg] [--tags a,b] [--guest <platform>]
MGT-STEP-2 修改标题/简介/封面：走同一 republish，--title / --description / --cover 覆盖对应字段
MGT-STEP-3 下线申请审批：pnpm editor removal → approve 下架+通知 / reject 拒绝+通知（拒绝原因规范见 REJ）
```
原则：**不是新建期**——期号/slug/播放统计/收藏/精选保留，仅内容字段替换；publishedAt 刷新（列表前移，ETag 变化客户端重新拉取）；
**republish 幂等**（重复调用只覆盖内容不产生重复期，重试安全——先确认目标 episodeId 正确）；无 cover 时保留旧封面；
服务端不自动通知投稿人（重做是内部动作）。

**MGT-IN 输入规范与依赖**
- republish 参数与 publish 一致：--title --description --summary --tags --language --guest --cover --audio
- 依赖：原始对话/采样仍在（草稿可复用；内容变化先 fetch 刷新）；成品音频 final.m4a 或 --audio 指定

**MGT-GATE 确认门选项与输出模板**
复用：脚本两关（SC-GATE-1..2）+ 语音确认门（TTS-GATE-1）+ 发布确认门（PUB-GATE-1），选项与展示同 SC-GATE / TTS-GATE / PUB-GATE。

**MGT-OUT 输出物存放与命名标准**
同 SC/TTS/PUB 草稿命名；republish 不产生新期，内容字段原地替换（不新建 episode 行）。
republish 成功即终态：progress 记 republished（不计入概览待办），并同 publish 清理语音/封面大文件（final.m4a / cover.jpg 等，见 DRAFT）；再重做需重跑 TTS → merge → cover。

**MGT-ERR 错误处理**
- episodes --match 定位不到 → 换关键词/期号重试；detail <submissionId> 确认
- 目标 episodeId 错误 → 先核对再 republish（幂等但会覆盖目标内容）
- 无 cover → 保留旧封面；试听未过 → 修好再发，不 republish
