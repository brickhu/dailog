# TOOL 工具链要点

> **索引**：主文档 `SKILL.md`（附录索引）｜ 详细运维记忆：`reference/toolchain-notes.md`

- **detail 含主持人称呼与画像**：`callName`（脚本开场自我介绍用，替换 role_block 的 {callName}，无则「主持人」；
  脚本语言与称呼语言不同时按 draft.md 点题段落的称呼改写转写，如 飞→Fei）与 `personaInfo` 快照
- **采样匹配（服务端自动）**：TTS 按脚本语言取采样 → 无则英文 → 无则最近一条兜底；detail 返回 voiceSamples 列表（全部语种）
- **publish 无响应 ≠ 失败**：服务端同步端点，受限网络下响应可能被邮件挂死——先 `detail/list` 查状态，published 即成功，勿重试
- **multipart 上传必须走 serializeFormData**（lib.ts 已接上；改上传端点时别把 formData 直接当 body）
- **本地环境存储是 R2**：发布产物在 R2 不在宿主机 data；重发同投稿覆盖旧音频但 episode 行每次新建（publish 非幂等；republish 幂等）
- **pnpm EPERM（DSH）**：根 .npmrc 已加 manage-package-manager-versions=false；仍报错直调 `node .agents/skills/dailog-editor/scripts/run.js`
- 其余（代理探测 / chatgpt SSR 解码 / 测试红线 / 本地容器 R2 代理 / local 端口等）：见 `reference/toolchain-notes.md`
