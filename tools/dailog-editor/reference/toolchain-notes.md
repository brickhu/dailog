# dailog 工具链运维记忆（不常用，按需查阅）

- **生成子代理（省 token 的关键）**：SC-STEP-1（dailog-select）/ SC-STEP-2（dailog-draft）
  两步生成一律起子代理执行，结果由子代理用 write 工具直接写盘（selection.json / chosen-idea.json /
  script.json），主会话只收一行校验摘要、不拉取不打印 JSON 全文——对话原文
  （15-20k）与提示词文件（~14k）不进主上下文。单期主会话增量从 ~70-90k 降到 ~15-25k；
  打回重跑：听感/结构反馈均重跑 SC-STEP-2（不重新全量注入）。
- **终稿确认门默认全文**：`pnpm editor script-preview <id>` 输出段数/字数/时长/每段说话人与开头
  摘要——作为终稿确认门的附加信息；完整脚本全文默认直接展示在回复正文（红线 3）。
- **呈现通道**：GUI（如 DSH）里工具输出对编辑不可见（默认折叠）——一切面向编辑的展示必须放
  回复正文；子代理 JSON 与命令 stdout 只作校验，不得当展示材料。
- **本地环境基址统一为 `http://localhost:8787`**（`api.dailog.orb.local` 已废弃）：
  `.dailog-editor/envs.json` 的 local 项 apiBase/siteUrl 均指向 localhost:8787（API/站点同端口）；
  纯 HTTP 走原生 fetch，`lib.ts` 中 `.orb.local` 的 TLS 忽略逻辑仅保留兼容旧地址。
- **代理探测**（`src/fetch.ts findSocksProxy`）：env `ALL_PROXY`/`HTTPS_PROXY`（含 socks）优先，
  其次 macOS `scutil --proxy`（SOCKSEnable+SOCKSPort）。走代理用 `curl --socks5-hostname`
  子进程（DNS 也过代理）——Node fetch/undici 原生不支持 SOCKS，别引入 socks 依赖重造。
- **chatgpt SSR 解码**（`src/fetch.ts decodeStreamTable`）：解码结构见 `reference/fetch-decoding.md`
  平台经验库 chatgpt 行——平台改版优先检查流式引用编码结构，别先改 DOM 规则。
- **multipart 上传必须走 `serializeFormData`**（`src/lib.ts`）：历史 `.orb.local`
  自签证书的 undici dispatcher 路径下原生 `FormData` 作 body 会失效——服务端收到空表单，
  publish/guest-voice 报 400 `audio_required`/`invalid_body`。`api()` 已接上自定义编码
  （字节流 + 手写 boundary + 显式 content-type）。**改 api()/加上传端点时别再把 formData
  直接当 body 传**——回归测试：multipart 请求后服务端能读到文件字段。
- **detail 已含主持人称呼与画像**：`getDetail` 返回 `callName`（submissions.call_name，投稿时配置、
  默认 displayName 可改）与 `personaInfo` 快照（displayName/性别/职业/年龄/国籍/bio），
  脚本生成时用 role_block 的 {callName}，无则「主持人」。脚本语言与称呼语言不同时按
  draft.md 点题段落的称呼改写规则转英文形式（如 飞→Fei）。
  **老投稿 call_name 常为空**（在线生成期未持久化）——detail 显示「无」时用 `pnpm editor callname <id> --name "飞"`
  补录（POST /v1/editor/submissions/:id/callname，2026-08-28 新增），持久化后不再回退「主持人」。
- **采样匹配（服务端自动）**：TTS 按脚本语言取采样 → 无则英文采样 → 无则最近一条采样兜底；
  `detail` 返回 voiceSamples 列表（全部语种），供编辑确认。
  **guest 音色替换（2026-08-28 新增）**：目标嘉宾无声线 → 自动用系统内其他嘉宾同语种音色替换合成
  （替换音色、不替换嘉宾名字）；响应头 `X-Guest-Voice-Note: guest-voice-replacement:<来源嘉宾>:<语种>`
  （ASCII，HTTP 头不允许中文）——CLI 解析后打印中文提示。
- **测试红线**：`publish` 端点无 dry-run——curl/脚本直打真实 submission 就是真实发布
  （curl 探测把投稿发布成带测试元数据的期）。探测 multipart 用本地回环
  服务器解析结构，或打已 published 的投稿（状态检查在 formData 解析前，不污染数据）。
- **本地环境存储是 R2**：`services/api/.env.local` 为 `STORAGE_DRIVER=r2`——发布产物在
  R2 不在宿主机 `services/api/data`；`episodes/{userId}/{submissionId}.m4a|mp3` key 确定性，
  重发同投稿会**覆盖旧音频对象，但 episode 行每次新建**（publish 非幂等，见下条）。
- **republish 是幂等的**（与 publish 不同）：更新已有 episode 行（确定性 id），重复调用只覆盖内容
  不产生重复期——重试安全；但仍需先确认目标 episodeId 正确（误传别的 episode 会覆盖其内容）。
- **publish 无响应 ≠ 发布失败**：publish 是同步端点，服务端在
  createPublished（期号+状态流转）之后才等 sendEmail——受限网络下 api.resend.com 不可达且原实现
  无超时，响应被邮件挂死；客户端超时被杀后重试会再建一期。已修复：sendEmail 加 10s 超时
  （`services/api/src/email/resend.ts`）；编辑侧 publish.ts 已加状态预检（非 submitted 拒绝）。
  遇 publish 无响应先 `pnpm editor detail/list` 查状态——published 即成功，勿重试。
- **本地容器 R2 代理是死配置**：`services/api/src/index.ts` 的 createStorage 未传 r2ProxyUrl，
  .env.local 的 R2_PROXY_URL 不生效；容器（OrbStack VM）直连 R2 可用（宿主直连才需代理）。
  改 storage 接线时别照抄 .env.local 的 127.0.0.1 代理——容器内应 host.docker.internal。
- **local 环境端口**：API localhost:8787（统一基址）/ 站点 localhost:3000（dailog 容器 80→3000）；
  envs.json 的 siteUrl 用于发布后节目地址展示。
- **pnpm 沙箱 EPERM（DSH harness）**：根 package.json 声明 `packageManager: pnpm@9.15.0`，
  而 DSH 内置 pnpm 为 10.x——版本不匹配时 pnpm 的 manage-package-manager-versions 机制会尝试把
  指定版本装到 `~/Library/pnpm/.tools/`（工作区外）→ 沙箱拦截 `EPERM: mkdir .../.tools/pnpm/9.15.0_tmp_*`。
  **解法（已固化根 .npmrc）**：项目根 `.npmrc` 加 `manage-package-manager-versions=false`，
  pnpm 直接用内置版本、不再写工作区外路径；或绕开 pnpm 直调 `node .agents/skills/dailog-editor/scripts/run.js`。
- **改 skill 必须改源码再 build（产物勿手改）**：`.agents/skills/dailog-editor/` 是构建产物
  （scripts/*.js 由 src/*.ts esbuild 编译、SKILL.md/prompts/reference 从 `tools/dailog-editor/`
  `skill/``prompts/``reference/` 复制），手改产物会在下次 build 被覆盖回源码——SKILL 文档/
  提示词/模板/命令逻辑一律改 `tools/dailog-editor/` 下源码，然后 `cd tools/dailog-editor && node build.mjs`
  （或 `pnpm --filter @dailogues/dailog-editor build`）同步产物；改完用 grep 校验产物已含新内容。
- **republish 元数据来自 metadata.json**：republish.ts 与 publish.ts 一致——description/summary/
  references/tags/highlights/category 自动读草稿 `metadata.json`（旧草稿 fallback script.json），
  `--description/--summary/--references-file/--tags` 可覆盖；漏读 metadata.json 会让服务端
  description/tags 等字段被清成 null（2026-08-26 踩坑：republish 后详情页无简介/标签）。
