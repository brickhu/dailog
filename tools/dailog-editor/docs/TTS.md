# TTS 生成语音（Voice）

> **索引**：主文档 `SKILL.md`（定义/触发见主文档）｜ 步骤 TTS-STEP-1..3 ｜ 确认门 TTS-GATE-1（=TTS-STEP-3）｜
> 节码 TTS-FLOW / TTS-IN / TTS-GATE / TTS-OUT / TTS-ERR
> 前置：SC-STEP-2（终稿 script.json）｜ 后续：PUB-STEP-1（语音确认通过后）

**TTS-FLOW 流程 / 原则 / CLI 调用逻辑**
```
TTS-STEP-1 生成语音：pnpm editor tts <id> --script script.json [--language zh|en] [--guest <platform>]
  · **--parts 三段独立合成（必需）**——片头要插在点题与对谈之间，merge 需要 part1/2/3 分段（单段更稳、可 --part n 单段重跑）。merge 最终顺序：part1（点题）→ intro 片头 → part2（对谈）→ part3（落点+收束）→ outro
  · 统一走服务端端点——编辑本地不直连 Fish Audio，Fish key 只配在服务端
  · host=投稿人采样，guest=服务端嘉宾声线（guest_voice_samples，见 CFG-STEP-2）；产物 full.mp3
TTS-STEP-2 合成：pnpm editor merge <id> [--language zh|en]
  · intro/outro 按语言自动匹配（assets/intro.{lang}.mp3，缺失 fallback 通用资产）；段间插 0.6s 静音
  · 产物 final.m4a；merge 完成自动用 QuickTime Player 打开试听（macOS）
TTS-STEP-3 语音确认门（TTS-GATE-1）：试听通过后才进入发布
```
原则：**发布前必须试听**（音色/断句/情绪标签）；顺序红线——语音未经编辑确认不得进入发布层。

**TTS-IN 输入规范与依赖**
- 输入：`script.json`（终稿，SC-STEP-2 产物）+ submissionId；`--guest` 目标嘉宾**必须已配置声线**
- 依赖：服务端 Fish key、嘉宾声线（`pnpm editor guests` 查看）、本地 ffmpeg/ffprobe
- 采样匹配（服务端自动）：按脚本语言取采样 → 无则英文 → 无则最近一条兜底

**TTS-GATE 确认门选项与输出模板**
语音确认门（TTS-GATE-1）交互（统一选号格式，见 RULES-10，一项一行）：
`[1] : ✅ 试听通过` → 进 PUB（发布）（PUB-STEP-1 封面 + PUB-STEP-2 元数据）
`[2] : 🔊 哪段有问题` → 重跑 tts --part n → 重新 merge 试听
`[3] : 🎨 顺带重做封面`（PUB-STEP-1 亦可后置到发布确认门）
输出模板：无 JSON 产物；产物为音频文件（见 TTS-OUT）。

**TTS-OUT 输出物存放与命名标准**
`drafts/{submissionId}/`：`full.mp3`（TTS 原始合成）、`final.m4a`（merge 合成成品，Apple 播客 AAC）；`--parts` 时含 `part1/2/3.mp3` 分段音频（`--part n` 可单段重跑）。

**TTS-ERR 错误处理**
- Fish 余额 / 限流 / 超时 → 汇报错误，按提示重跑该段（--part n）或整集
- 422 无声线 → 先回 SC-GATE-2 解决（上传声线 / 换有声线嘉宾 / 暂停），见 CFG-STEP-2
- merge 资产缺失 → 警告跳过或显式 `--intro/--outro` 指定；异常 → 修好再发
