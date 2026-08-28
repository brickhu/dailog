# RES 进度与恢复（Resume）

> **索引**：主文档 `SKILL.md`（附录索引）｜ 跨能力：任何中断的草稿流程

每命令完成自动写 `drafts/{id}/progress.json`。新对话恢复：① 会话初始化 → ② `pnpm editor progress
<submissionId>`（进度 + 下一步 + 产物清单）→ ③ 按提示继续（已有产物自动跳过重复步骤）。
终态 step：published / rejected / republished（不计入概览待办）。
