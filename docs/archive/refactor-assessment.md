# 改造评估与实施计划 — 旧模型 → 投稿制

> 状态：定稿（2026-08-11）。依据：代码全量探查（services/api 13 路由 / admin / site）+ 产品定稿（MRD §1/§5 · PRD · AGENT）。
> 目标模型：**单一品牌频道 dailog + 投稿制 + 编辑人工驱动**——注册（邮箱验证）即投；编辑（admin.dailog.fm 管理员工作台，admin/editor）触发审核/润色/选脚本/生成/自动发布；无邀请码、无计费、无用户侧润色上限。
> 配套：[MRD.md](../MRD.md) · [PRD.md](../PRD.md) · [ARC.md](../ARC.md) · [AGENT.md](../AGENT.md)

---

## 1. 现状盘点（代码真实状态，2026-08-11 探查）

### 1.1 可直接复用（零改动）

| 资产 | 位置 | 说明 |
|---|---|---|
| 六平台采集 | `services/importer/`（独立服务） | 分享链接解析，独立部署 |
| 生成管线 | `services/api/src/pipeline/`（queue/runner/tts/merge） | host=投稿人人设样本、guest=品牌声线，语义已对 |
| 嘉宾库 | `guests` + `guest_voice_samples` 表 | 品牌声线管理 |
| **人设** | schema `0016_host_persona` + `/v1/me/persona` | 新模型核心概念已存在 |
| 多语言音轨 | `tracks` 表 | 不做单节目多语言音轨（翻译版 = 新节目）；`language` 列保留扩展性 |
| 全局快照 | `snapshots`（URL 唯一） | 投稿去重基础 |
| 审核+润色形态 | `llm/prompts.ts`（quality_failed 内联分支） | 恰为"编辑触发审核+润色"形态，prompt 级更新即可 |

### 1.2 旧模型耦合点（需删/改）

| 耦合 | 位置 | 处置 |
|---|---|---|
| 邀请码链 | `invite_codes` 表、`user.invite_code` 残留、`routes/channel.ts` 激活、`routes/admin.ts` 邀请码端点、`cli/invites.ts`、`profiles.channel_activated_at`（polishes/new、episodes/new、publish 三处 403） | **删** |
| 配额体系 | `quota.ts`（期数制）、`profiles.plan/credit_balance`、episodes/new 扣费、transcripts 润色上限（free 5/pro 不限） | **删扣费**；润色上限全删（编辑驱动） |
| 每用户频道 | `profiles.username` 唯一、site `[username].tsx` + `[username]/feed.xml.ts` + `lib/db.ts` 按 username 查询 | **改**（作品集 + 单 feed） |
| 投稿人自助发布 | `routes/episodes.ts` publish 无角色鉴权；旧 studio 创作流（已移出集成） | **改**（编辑驱动 + 角色） |
| 死代码 | `payments`/`subscriptions` 表（无 stripe 调用）、`snapshots.quality` 无调用者 | 删（或 v2 预留） |

## 2. 逐模块改造清单

| 模块 | 位置 | 改动 | 量级 |
|---|---|---|---|
| 邀请码全链 | 见 §1.2 | 删除（一次 migration） | S |
| 配额/润色上限 | `quota.ts` + schema | 删除扣费与润色限次 | S |
| 角色体系 | `middleware/auth.ts` + `profiles.role` | **新增** admin/editor/user + 鉴权中间件 | M |
| 投稿状态机 | `episodes.status` | submitted/accepted/generating/published/failed + 提交端点 | M |
| 编辑路由 | 无 | **新增** `/editor/reviews/:id/process`、`reject`；publish 加 editor 鉴权；`is_picked` 标记 | M |
| 润色/审核 prompt | `llm/prompts.ts` | 四类价值（交锋/新知/情感/经验）+ 访谈式结构 | S |
| site 首页 | `routes/index.tsx` | landing 首屏（左 tagline+CTA / 右精选播放器，过渡期取最新节目） | S |
| site 投稿流程 | 无 | **新增** `/submit`（导入→人设→提交）+ `/me/submits` | L |
| site 探索系 | 无 | `/discover`（新热精荐）、`/tags`、`/episodes` 搜索 | M |
| site 账户系 | `account.tsx`/`me.tsx` 已有 | `/account/*`、`/me/*`（favorites/likes/episodes）扩展 | S-M |
| site 作品集/单 feed | `[username].tsx` + `feed.xml.ts` + `lib/db.ts` | 频道页→投稿人作品集；`/feed.xml` 单 feed | M |
| site 主持人/嘉宾页 | 无 | `/hosts`、`/guests` | S |
| studio 重定位 | `apps/studio` | 删投稿人页面；**新建** login 门禁（admin/editor）+ `/queue` + `/reviews/:id`（复用 script-editor） | L |
| 录音组件复用 | `apps/studio/src/components/recorder.tsx` | site 投稿流程需要 → 移入 `packages/ui`（SSR 安全：浏览器 API 仅 effect 内）或 site 内实现 | S |

## 3. 实施阶段计划

| 阶段 | 内容 | 产出 / 验收 |
|---|---|---|
| **P0 清地基** | 删邀请码/配额/润色上限/频道激活；`profiles.role` 默认 user；episodes 状态机加 submitted | 一次 migration；后端测试全绿；无 403 channel 门禁 |
| **P1 首页 + 投稿流程**（✅ 已完成 2026-08-11） | site `/` landing；`/submit`（导入→人设→提交）；后端投稿提交端点；`/me/submits`；注册/登录（邮箱验证） | 注册 → 投稿 → /me/submits 显示"审核中"全链路；typecheck/build/workerd 冒烟全绿 |
| **P2 后端编辑能力**（✅ 已完成 2026-08-11） | 角色体系（`profiles.role` + requireRole）；编辑路由（queue/reviews/process/reject/transcripts/episodes new/publish/cover-search/guests）；发布环节（LLM 预填 + 期号分配 + 封面候选）；管线 done → ready → 编辑确认发布 | 145 tests 全绿；容器 E2E：编辑登录 → 队列 → 详情 → reject（reason）→ 投稿人可见；普通用户 403 |
| **P3 编辑工作台** | apps/admin：login 门禁 + /queue + /reviews/:id（复用 script-editor）+ /settings | admin/editor 登录后完整驱动一期节目上线 |
| **P4 site 剩余** | /discover（新热精荐）、/tags、/episodes 搜索、/me 系、/account 系、/hosts、/guests、作品集 + 单 feed | 全部路由可达，SSR 冒烟 |
| **P5 收尾** | prompt 更新（四类价值 + 访谈式结构）；精选机制切换；平台入驻申报 | 编辑端与投稿端联调；Apple/Spotify/小宇宙提交 |

**P1 任务拆解（已完成）**：
1. ✅ 后端：`POST /api/v1/submissions`（snapshot 查重 → polish 容器 status=submitted）+ `GET /api/v1/me/submissions`；迁移 0017（profiles.role）；**投稿状态机承载于 polishes**（episodes.transcriptId NOT NULL，投稿阶段无脚本——实现期对模型的自然修正）
2. ✅ site：`/` landing（左列 tagline + what it is + 立即投稿 CTA；右列播放器，服务端取最新已发布节目）
3. ✅ site：`/submit` 三步（导入：采集预览复用 importer API → 人设：录音 + 信息（persona API）→ 提交）+ 站内代理路由（v1/import、v1/submissions、v1/me/persona、v1/me/voice-sample、v1/me/submissions）
4. ✅ site：`/me/submits` 投稿状态列表
5. ✅ 录音组件：recorder 复制到 site（apps/site/src/components/recorder.tsx，SSR 安全——浏览器 API 仅在事件内）；**待收敛**：后续统一移入 packages/ui

## 4. 风险与注意事项

- **migrations**：已有 17 个迁移文件，新增字段（role/is_picked/submitted）继续增量迁移，不改历史
- **SSR 安全**：site 是 SolidStart SSR——录音/播放器组件浏览器 API 只能出现在客户端 effect/事件内（packages/ui 约束 §AGENT）
- **script-editor 复用**：编辑工作台直接复用，需剥离投稿人语境（保留方向指示/水印）
- **质量审核内联润色**：语义复用，prompt 更新为四类价值 + 访谈式结构（P5）
- **首屏播放器过渡**：v1 取最新已发布节目，`is_picked` 精选随 P2/P3 编辑端上线后切换
- **历史实施计划**：`docs/superpowers/plans/` 为时间记录，不回溯修改

## 5. 关键文件索引（改造入口）

- 后端路由：`services/api/src/routes/{channel,episodes,polishes,transcripts,admin,voice,profile}.ts`
- 配额：`services/api/src/quota.ts`（删）；LLM：`services/api/src/llm/prompts.ts`
- schema：`services/api/src/db/schema.ts` + `drizzle/`（迁移）
- studio：`apps/studio/src/{main.tsx, pages/, components/script-editor.tsx, components/recorder.tsx}`
- site：`apps/site/src/routes/{index,submit,me,account,[username],episode,[id],feed.xml}.tsx` + `lib/db.ts`
