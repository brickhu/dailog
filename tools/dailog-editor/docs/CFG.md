# CFG 配置（Config）

> **索引**：主文档 `SKILL.md`（定义/触发见主文档）｜ 步骤 CFG-STEP-1..2 ｜
> 节码 CFG-FLOW / CFG-IN / CFG-GATE / CFG-OUT / CFG-ERR
> 关联：声线是 TTS 的 guest 音源（TTS-STEP-1 使用）；播放列表封面复用 PUB-STEP-1 cover 引擎

**CFG-FLOW 流程 / 原则 / CLI 调用逻辑**
```
CFG-STEP-1 播放列表（playlist）：
  pnpm editor playlist list | create "<标题>" [--desc] [--picked] [--private]
  pnpm editor playlist episodes <id> | add <id> <episodeId|#期号> | remove <id> <episodeId>
  pnpm editor playlist reorder <id> <id1,id2,...> | pick/unpick <id> | public/private <id> | delete <id>
  pnpm editor playlist cover <id> [--texture ...] [--colors ...] [--image-url <URL>]
CFG-STEP-2 嘉宾信息与声线：
  pnpm editor guests                          # 查看已配置嘉宾及其声线
  pnpm editor guest-voice <id> --audio <file> # 上传嘉宾声线（服务端 guest_voice_samples）
  pnpm editor guest-set <id> --name           # 设置嘉宾称呼
```
原则：声线是 TTS 的 guest 音源（`tts --guest <platform>` 使用，未配置 → 422）；主持人（投稿人）声线来自投稿采样无需配置；
播放列表封面复用单集 cover 引擎 → 上传 R2（sharp 归一 1400²），无自定义封面前端自动取首期封面。

**CFG-IN 输入规范与依赖**
- playlist：标题/描述/私有标记；节目引用支持 #期号；**收录仅限已发布公开节目**；删除级联清理条目
- guest-voice：音频文件，multipart 上传必须走 serializeFormData（lib.ts 已接上）

**CFG-GATE 确认门选项与输出模板**
无确认门（命令即生效）；配置结果通过命令输出核对（如 guests 列表、playlist list）。

**CFG-OUT 输出物存放与命名标准**
无本地草稿产物；播放列表封面上传 R2（1400² 归一）。

**CFG-ERR 错误处理**
- 声线未配置 → TTS 422（在 SC-GATE-2 预检解决，不上传则先告知编辑）
- guest-voice 上传失败（400 audio_required/invalid_body）→ 检查 multipart 编码（serializeFormData）
