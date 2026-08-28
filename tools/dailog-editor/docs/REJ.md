# REJ 拒稿规范（Reject）

> **索引**：主文档 `SKILL.md`（附录索引）｜ 被 SC-GATE-1/2/3、PUB-GATE-1、BATCH-STEP-1/3、MGT-STEP-3 引用

**拒稿（reject）= 拒绝一篇投稿**：原因必填且具体（投稿人可见），站内通知 + 邮件；
`progress.json` 记为 `rejected`（终态，不计入概览待办）。

**发生点与动作**：
| 环节 | 触发 | 动作 |
|---|---|---|
| SC-GATE-1 选题确认门 | 编辑选 `[R] ❌ 拒稿` | SC-STEP-1 已落 quality.json {pass:false, reason}（reason 取自 reject.feedback，面向投稿人）；主会话经编辑确认后执行 `reject <id> --reason "…"` |
| SC-GATE-2 终稿确认门 | 编辑选 `[4] ❌ 拒稿` | 同上：`reject <id> --reason "…"`（原因必填） |
| PUB-GATE-1 发布确认门 | 编辑选 `[5] ❌ 取消` 且决定不发布 | `reject <id> --reason "…"`（拒稿原因） |
| BATCH-STEP-1/3 批量处置 | ⚠️/❌ 组或质量不过关组选 `[2] 拒稿` | `batch-reject --ids <id1,id2,...> [--reason "兜底原因"]`——每条优先取草稿 quality.json 的 reason（逐条原因），缺失用 --reason 兜底，无原因条目跳过 |
| MGT-STEP-3 下线申请审批 | 编辑选 reject | `removal` → reject（拒绝下线申请 + 通知） |

**原因规范**：
- **必填**：`reject` 无 `--reason` 直接报错退出；`batch-reject` 无原因条目跳过不拒
- **具体**：写清楚为什么（质量/合规/无时刻/骨架断裂/任务型对话…），投稿人可见且邮件会发送
- SC-STEP-1 层拒稿原因落 quality.json 的 reason，供 batch-reject 逐条复用

**状态与通知**：rejected + 站内通知 + 邮件（投稿人在 /me/submits 可见拒稿原因）；草稿保留可复查/重做。
