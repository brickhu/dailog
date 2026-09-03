# 投稿状态机（submission state machine）

> 核心事实：`submissions.status` 是 **postgres text 列**（无 DB 级约束），枚举值集合与流转规则在 **TS 类型 + repo 方法 + 接口校验** 三层实现。改枚举/加状态**永远不需要 DB migration**。

## 1. 状态定义

| 状态 | 含义 | 编辑能做什么 | 卡片展示 |
|---|---|---|---|
| `submitted` | 投稿成功，未采集 | 采集 | 采集卡（采集按钮） |
| `collected` | 原始对话采集成功 | 审题 → 脚本 → 打磨/TTS → 合成 | 采集卡（预览）+ 创作卡 |
| `crafted` | 创作完成（音频已上传 R2），未发布 | **只能发布** | 采集/创作（预览）+ 发布卡 |
| `published` | 已发布（episode 已创建） | 发布卡可编辑节目 meta | 全部卡片结果预览 + 节目 URL |
| `rejected` | 拒稿（采集失败 / 审核失败 / 手工拒绝） | 无（终态，可看原因） | 拒稿原因展示 |

## 2. 状态流转表

```
submitted ─采集成功(setCollected 1)──→ collected
submitted ─采集失败(setCollected -1)─→ rejected
collected ─创作完成(音频上传确认)────→ crafted
collected ─审核失败(review→reject)───→ rejected
crafted ──发布(markPublished)────────→ published
任意状态(非 published) ─手工拒绝(reject)─→ rejected
collected ─重置采集(setCollected 0)──→ submitted
```

## 3. 流转执行点（实现位置）

| 动作 | API 端点 | repo 方法 | 写入 |
|---|---|---|---|
| 采集成功 | `PATCH /v1/editor/submissions/:id/collected` `{collected:1}` | `setCollected(id, 1)` | status=`collected` |
| 采集失败 | 同上 `{collected:-1}` | `setCollected(id, -1, reason?)` | status=`rejected` + rejected_reason |
| 重置采集 | 同上 `{collected:0}` | `setCollected(id, 0)` | status=`submitted` |
| 创作审核 | `POST /v1/editor/submissions/:id/review` | `setReview(id, {rejected, score})` | 通过：不写 review_status（无 approved），仅记 score；失败：review_status=`rejected` + `reject()` |
| 音频上传确认 | `POST /v1/editor/submissions/:id/crafted` | `setStatus(id, 'crafted')` | status=`crafted` |
| 发布 | `POST /v1/editor/submissions/:id/publish` | `markPublished(id)` | status=`published` |
| 手工拒绝 | `POST /v1/editor/submissions/:id/reject` `{reason}` | `reject(id, reason)` | status=`rejected` + rejected_reason |

## 4. 接口校验规则（routes/editor.ts）

| 端点 | 状态约束 |
|---|---|
| `POST .../reject` | `status === 'published'` → 409；其余（submitted/collected/crafted）可拒 |
| `POST .../publish` | 仅 `submitted` / `crafted` 可发布；rejected/published → 409 |
| `GET .../submissions?status=` | 白名单：submitted / collected / crafted / published / rejected；未知值回退 `submitted` |

## 5. 相关字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `collected` | smallint | 采集状态冗余（-1/0/1），status 为权威，保留兼容 |
| `review_status` | text | 仅 `rejected` 写；通过不写（**无 approved 概念**） |
| `review_score` | real | 审核得分（0-10），始终记录 |
| `rejected_reason` | text | 拒稿原因（rejected 必填，投稿人可见） |

## 6. 前端状态渲染（detail.js）

- 状态标签：submitted 待采集（灰）/ collected 制作中（蓝）/ crafted 待发布（黄）/ published 已发布（绿）/ rejected 拒稿（红）
- 采集卡：`status === 'submitted'` → 采集按钮；其余 → 已采集预览
- 创作卡：`collected` + 有脚本 → 脚本工作区；无脚本 → 开始创作（审题入口）；`crafted` → 创作完成；`rejected` → 拒稿原因
- 发布卡：`crafted` / `published` 显示
- 拒稿按钮：投稿卡头部，未 `published` 前显示

## 7. 与产出物/素材的关系

| 数据 | 位置 | 推导 |
|---|---|---|
| 产出物① 原始对话 | R2 `dialogues/{sha256(url)前32}.json` | URL 哈希 |
| 产出物② 打磨脚本 | R2 `scripts/{id}.json`（已规范化；旧 `workflows/{instance}/{id}.json` 兼容回退读取） | 投稿 ID |
| 产出物③ 合成音频 | R2 `episodes/{userId}/{id}.m4a`（合成确认直接写最终位置，发布零拷贝引用；旧 `full/{id}.m4a` 兼容回退） | 投稿 ID |
| 生产素材（store） | 浏览器 `assets-{id}` | 投稿 ID |

> **素材清除时机 = 节目发布后（published）**：发布成功时清浏览器素材（store / seg 语音缓存 / full 本地缓存 / fullmeta），3 个 R2 产出物保留。crafted 后素材保留（可改脚本/重新生成 meta）。

## 8. 状态机规则的"软约束"说明

DB 是 text 列，不拦截非法值——所有写入必须走 repo 方法（类型安全），禁止绕过接口裸 SQL 写 status。改状态集合 = 同步改：schema.ts TS 枚举 → repo 方法 → 接口校验 → 前端渲染映射。
