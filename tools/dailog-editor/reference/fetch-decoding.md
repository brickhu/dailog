# dailog 采集 + 内容解码（参考）

> 自 SKILL.md「CL 采集」节抽离的深度参考。日常流程只记命令入口与操作要点（见 SKILL.md「CL 采集」节）；
> 平台内部机制、代理兜底、提取策略、浏览器兜底步骤、解码规则自进化、平台经验库 全在本文。
>
> 入口：`pnpm editor fetch <id>` → 拉取投稿 URL 并解码落盘草稿目录：
> `page.html`（原始 HTML）/ `page.txt`（清洗后正文）/ `dialogue.json`（提取的消息）。


- 从投稿详情拿 URL → **平台分派**（fetch 内置）：
  - **deepseek/doubao 分享 API 直取**（SSR 壳平台首选——见平台经验库，命中直接 dialogue.json）
  - **chatgpt SSR 流解码**（对话在 React Router 流式数据里，不依赖 DOM 渲染）
  - **gemini 规则直取**（分享页 Angular SSR，短链→规范 URL→SSR 规则提取，见平台经验库）
  - 其余：拉取页面（UA 伪装、跟随重定向、30s 超时）→ 解码落盘草稿目录：
    - `page.html`：原始 HTML；`page.txt`：清洗后正文；`dialogue.json`：提取的消息
      `[{role: "user"|"assistant", content}]`
- **代理兜底（直连失败自动重试，已实测）**：直连超时/被封锁 → 自动探测本地 SOCKS5 代理
  （env `ALL_PROXY`/`HTTPS_PROXY` 含 socks → macOS 系统代理 `scutil --proxy`）→
  `curl --socks5-hostname` 重拉（DNS 也过代理，绕污染）。chatgpt.com 等被网络封锁的域名靠这条路径
- **提取策略（自进化，三级，规则加载：本地优先 → 产物 fallback）**：
  1. **规则库命中**（host+pathPrefix → 选择器）→ 按规则提取（命中 hits 自动 +1 写回）
     - 优先 `.dailog-editor/rules.json`（自进化主文件）；本地缺失 → fallback 产物种子
       `assets/rules.json`（工程随构建分发，只读）；命中后进化落本地
  2. 无规则 → **通用嗅探**（`data-message-author-role` 容器）
  3. 都失败 → 浏览器兜底 + **沉淀新规则**（见下）
- **浏览器兜底（反爬终极方案——用户自己的浏览器已过 CF 挑战）**：
  1. `pnpm editor console-script <id>` 生成控制台脚本（有规则内联选择器，无规则通用启发式）
  2. 用户打开分享页 → F12 Console → 粘贴运行 → 脚本自动复制对话 JSON 到剪贴板
  3. 用户粘贴回对话 → `pnpm editor paste <id>` 校验入库（消息双全）→ 继续管线
  4. 或 browser-use 打开页面滚动加载 → 复制正文 → Agent 提炼
  （保证 user 与 assistant 消息都提取到——缺一方 = 内容不完整，继续兜底）
- 拉取失败（403/超时/失效）→ 如实汇报，引导用户走浏览器控制台兜底

#### 解码规则自进化（大模型学习闭环——遇到新平台结构时）

```
流程跑起来后采集出问题（规则未命中/提取失败）：
  ① 大模型学习：分析草稿 page.html，逆向消息容器——
     角色标识 attribute（data-message-author-role / data-testid 等）、内容子容器（.markdown 等）
  ② 生成候选规则 → 用草稿验证（不重新拉取）：
     pnpm editor rule-test <id> --user-selector "..." --assistant-selector "..." [--content-selector "..."] --platform <平台>
     · ✅ 消息双全（user + assistant 都有）且与人工核对一致 → 跑通
     · ⚠️ 只命中单侧 / 零命中 → 调整选择器重试
  ③ 跑通后入库（自动写 .dailog-editor/rules.json，host/pathPrefix 从投稿 URL 推断）：
     pnpm editor rule-test <id> ... --save
  ④ 下次 fetch 同平台投稿自动命中（无需 build，即时生效）
```

**红线**：规则必须基于真实 DOM 采样（草稿 page.html），不凭猜测写选择器；
选择器用稳定 attribute（`data-message-author-role` / `data-testid`），不用 react class / 索引；
新增规则必须配套验证（rule-test 消息双全 / 重新 fetch 命中）才算入库——失败规则不沉淀。

**平台经验库**（已沉淀规则，遇到同平台直接复用）：

| 平台 | 规则状态 | 选择器要点 |
|---|---|---|
| chatgpt | ✅ SSR 流解码内置（已实测） | 分享页对话**不在 DOM**，在 React Router 流式 SSR 引用编码（`streamController.enqueue("...")` + 字符串表压缩：dict 的 key/value 与 list 元素均为表索引、负值为 null、`['P', n]` 自引用防环）——fetch 已内置解码器。本机直连 chatgpt.com 被网络封锁（DNS 污染 + SNI 阻断）→ 自动走本地 SOCKS5 代理。DOM 规则（`div[data-message-author-role]` + `.markdown`）保留作解码未命中时的兜底 |
| doubao | ✅ API 直取内置（已实测） | 静态 HTML 是 SSR 壳（`_ROUTER_DATA.shareInfo` 为空，对话不内嵌）。**分享接口**：`POST https://www.doubao.com/im/message/share/get`，body `{"share_id":"<thread id>"}`（UA 伪装 + Origin/Referer 分享页）→ `data.message_snapshot.message_list[]` 每条 `{user_type: 1=用户/2=AI, content: '{"text":"..."}'}`，按 `index_in_conv` 排序 → 转 `dialogue.json`（alice 变体 `/alice/message/share/get` 会报 710020202，用 im 变体） |
| claude | 待沉淀 | 分享页内容在 JS 数据（CSS 提取不到）——浏览器兜底后按需沉淀 |
| deepseek | ✅ API 直取内置（已实测） | 静态 HTML 是 SPA 壳无内容（CSS 规则不可用）。**分享接口**：`GET https://chat.deepseek.com/api/v0/share/content?share_id=<id>`（UA 伪装 + `Referer: https://chat.deepseek.com/share/<id>`）→ `data.biz_data.messages[]` 每条 `{role: "USER"\|"ASSISTANT", content}` → 转 `dialogue.json`（小写 role）落草稿即可继续管线 |
| gemini | Chromium 渲染 + DOM 提取（已实测） | 分享页是 Angular 客户端渲染（SSR 只有壳，curl 拿不到对话）——fetch 内置：detectPlatform 识别 gemini → resolveGeminiCanonical 短链→规范 URL → findChromium 找 Playwright 缓存的 headless Chromium → renderWithChromium 无头渲染（15s virtual-time-budget + SOCKS5 代理）→ extractGeminiByRule（user=.query-text-line / assistant=message-content .markdown，per-role 规则，实测 3 轮 6 条双全）。已逆向分享内容 RPC：ujx1Bf（对话数据，f.req=[null,"<shareId>",[4]]）+ f.sid 会话流（每次会话变化，RPC 方案脆弱，仅记录备选）。规则已入 assets+rules.json（短链/规范页双 host）；无 Chromium 环境时 console-script 兜底 |
| grok | ✅ Chromium 渲染 + DOM 提取（已实测） | 分享页 `x.com/i/grok/share/<id>` 是 React SPA——对话**不在初始 HTML**（`__INITIAL_STATE__` 的 grokShare entities 为空），curl 只能拿壳；且直连 x.com 被网络封锁（SSL_ERROR_SYSCALL）。fetch 内置：detectPlatform 识别 grok → renderWithChromium 无头渲染（走 SOCKS5 代理）→ 渲染后 DOM 提取：turn 容器 `div.r-obd0qt.r-1cmwbt1` 内 user 段 `> div.r-1habvwh`（正文 `.r-1kt6imw`）+ assistant 段 `div.r-1awozwy.r-16lk18l`（正文 `.r-rjixqe.r-16dba41.r-imh66m`），per-role 规则实测 20 轮 40 条双全。分享页未登录也渲染完整对话（登录横幅与对话并存）。规则已入 assets+rules.json（x.com/twitter.com 双 host）；无 Chromium 环境时 console-script 兜底 |
| kimi/tongyi/perplexity | 待沉淀 | 首次遇到时走浏览器兜底 + 规则沉淀流程 |

> **接口逆向法**（deepseek 已验证的通用路径）：SPA 分享页拉不到内容时，先拉页面 `main.*.js`
> 从 bundle 里 grep `"/api/[^"]*"` 找分享数据接口（deepseek 是 `/api/v0/share/content`，
> GET + `share_id` 查询参数即可），比浏览器兜底更快——命中即结构化 dialogue.json。
