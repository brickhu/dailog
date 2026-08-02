# Spike: 各平台聊天页 DOM 勘察（登录态，扩展采集可行性）

> 日期：2026-08-02 · 状态：**进行中（待登录态实测补全）** —— 选择器/滚动机制来自公开逆向资料，登录态 DOM 实测待主会话 IAB 补测
> 前置：`docs/spikes/headless-cf.md`（无头方案否决 → 浏览器扩展为统一采集通道）· 配套：ARC §3.5 / PRD §4.3
> 采集协议：`{ platform, conversation_id, title, url, messages: [{role, content}] }`

## 勘察方法与本档的可信度说明（重要）

本任务原计划用受控浏览器（IAB，登录态）逐一打开平台对话页做 `domSnapshot` 实测。**执行中受阻**：

1. **浏览器对子代理不可用**：Node REPL 中的浏览器桥接存在，但 `assertAvailable()` 硬性拦截（`Browser is not available in subagent`）；browser-use 插件 SKILL 亦声明浏览器为主代理专用、不得委派给子代理
2. **HTTP 直取被反爬/区域限制**：`claude.ai/share/*` 对 WebFetch 302 → `anthropic.com/app-unavailable-in-region`；`chat.deepseek.com` 对 curl（含本地 SOCKS 代理）返回 **429 Request Blocked** 反爬页——脚本级访问全部不可行，**登录态 DOM 观测只能由真实浏览器完成**

因此本档的 DOM 细节（选择器、滚动机制）**全部来自公开逆向资料**（开源导出/采集项目、社区实测文章，见各平台"来源"），已尽量交叉验证，但仍属「未实测」；**所有条目需在主会话 IAB 登录态下逐项核对**（核对清单见文末）。平台顺序按任务要求：Claude / DeepSeek 优先（用户有账号），ChatGPT / 豆包 / Kimi / 通义 / Gemini 按可用性补充。

---

## 1. Claude（claude.ai）—— 采集可行性：**高**（预计首批交付）

### URL 模式
- 对话页：`https://claude.ai/chat/{uuid}`（uuid 为 36 位 UUID，含连字符）→ content script 匹配 `*://claude.ai/chat/*`
- 分享页：`https://claude.ai/share/{uuid}`（无需登录，但 **Cloudflare Turnstile 质询**，见 headless-cf.md；仅真人浏览器可达）
- 新会话入口：`claude.ai/new`

### 消息块容器（公开资料，多源交叉验证）
| 角色 | 选择器 | 备注 |
|---|---|---|
| 用户消息 | `[data-testid="user-message"]` | **最稳定、多源一致**；旧版类 `.font-user-message` / `.human-turn` |
| 助手消息 | `[data-is-streaming]` | 流式结束后仍保留该属性；**无 `data-testid="ai-turn"`**（常见误判，实测为 0） |
| 旧版兜底 | `.font-claude-response` | 历史上反复失效 |
| 动作条锚点 | `[data-testid="action-bar-copy"]` / `[role="group"][aria-label="Message actions"]` | 用于 ancestor-walk 定位 turn 容器（DOM 无 turn 级包装层） |
| 输入框 | `div.ProseMirror`（contenteditable） | 采集不需要，只作页面就绪判据 |

- 稳定策略：从动作条/用户消息节点向上走 ancestor，停在「包含 user-message 后代」的层级之下，再取兄弟节点为助手消息

### 滚动加载机制
- **无公开的虚拟列表证据**：社区采集工具（claude-chat-export-incognito 等）直接全量遍历 DOM 即可取到整段对话；长对话是否按需加载 **待实测**
- 滚动策略：普通对话一次遍历；若长对话实测出现懒加载，则按「滚动到顶/底 + MutationObserver + 去重」循环

### 消息内容形态
- 用户：纯文本 + 附件（文件/图片，附件块在 DOM 中）
- 助手：markdown 渲染 + 代码块（`pre > code`）；**思考过程（Thinking 折叠面板）在 DOM 中**——Thinking-Claude 等扩展直接操作 `div[data-is-streaming] pre:first-child .code-block__code`（折叠态 textContent 可读）

### 截断风险
- 未见公开的虚拟化截断报告；**待实测**长对话（数百轮）DOM 是否完整

### 元数据位置
- **对话 ID**：URL `claude.ai/chat/{uuid}`（可直接取）
- **标题**：页面 `<title>` 与顶部标题区（公开工具多用 `document.title`）；侧栏会话项亦有；确切 testid **待实测**（曾见 `chat-page-title` 类名传闻，未证实）

### 来源
[dev.to: What I learned building a Chrome extension for Claude.ai](https://dev.to/)（Claude DOM 实测）、[sank3t9/claude-chat-export-incognito](https://github.com/sank3t9/claude-chat-export-incognito)（Firefox 扩展，selectors.js + 诊断脚本）、[Eshaan-Nair/ArcRift PLATFORM_SELECTORS.md](https://github.com/Eshaan-Nair/ArcRift)（2026-05 验证的跨平台选择器表）、[richards199999/Thinking-Claude](https://github.com/richards199999/Thinking-Claude)（思考块选择器）

---

## 2. DeepSeek（chat.deepseek.com）—— 采集可行性：**高**（预计首批交付）

### URL 模式
- 对话页：`https://chat.deepseek.com/chat/{id}`（id 为长字符串，具体编码格式**待实测**；分享页为 `/share/{id}`）→ content script 匹配 `*://chat.deepseek.com/chat/*`

### 消息块容器（公开资料）
| 角色 | 选择器 | 备注 |
|---|---|---|
| 用户消息 | `[data-message-author-role="user"]` | 镜像 ChatGPT 的属性模式；兜底 `.user-message` / `[class*="UserMessage"]` / `[data-testid="user-message"]` |
| 助手消息 | `.ds-markdown` | **`ds-` 产品命名空间，较耐用**；兜底 `[data-message-author-role="assistant"]` / `[class*="AssistantMessage"]` |
| 滚动容器 | `.ds-scroll-area > .ds-virtual-list` | 公开爬虫实测的滚动容器结构 |

### 滚动加载机制
- **虚拟列表（实测确认，公开爬虫文章）**：仅渲染视口附近消息；**超过 50 轮的对话，直接复制可见区会丢约 30% 历史**
- 采集策略：向上滚动（scroll 至顶）触发历史加载 → 等待 DOM mutation → 收集去重 → 循环；或先触发打印预览等技巧让虚拟列表全量渲染

### 消息内容形态
- 助手：markdown 渲染（`.ds-markdown`），代码块、数学公式完整保留
- **思考过程（DeepThink / R1 推理步骤）在 DOM 中**（折叠块），导出器可完整保留 → 采集时折叠块 textContent 可读

### 截断风险
- **虚拟列表 = 天然截断**，是采集的主要适配点（滚动循环必须实现）
- 备选路径：有导出器 hook 内部 API + IndexedDB 回退（说明前端缓存了全量对话数据，DOM 采集不是唯一路径）

### 元数据位置
- **对话 ID**：URL `chat.deepseek.com/chat/{id}`；分享页 `/share/{id}`
- **标题**：导出器直接抓取当前对话标题作为文件名（标题在 DOM 中，确切选择器**待实测**）

### 来源
[Eshaan-Nair/ArcRift](https://github.com/Eshaan-Nair/ArcRift)（2026-05 验证）、微信公号「私有化留存 DeepSeek 对话」爬虫实测（`.ds-message` / `.ds-markdown` / `ds-scroll-area` / `ds-virtual-list` XPath）、51CTO「DeepSeek 网页版懒加载与虚拟列表」、Greasy Fork DeepSeek 导出器（打印预览触发全量渲染 / hook fetch 取推理链）

---

## 3. ChatGPT（chatgpt.com）—— 采集可行性：**中~高**

### URL 模式
- 对话页：`https://chatgpt.com/c/{uuid}`（旧域 `chat.openai.com/c/{uuid}`）→ content script 匹配 `*://chatgpt.com/c/*`

### 消息块容器（公开资料，多源一致）
| 角色 | 选择器 | 备注 |
|---|---|---|
| 消息轮次 | `article[data-testid*="conversation-turn"]`（或 `div[data-testid*="conversation-turn-*"]`） | 当前结构；旧版 `div[data-message-id]` 兜底 |
| 角色 | `[data-message-author-role="user"|"assistant"|"system"|"tool"]` | **多年跨改版稳定**，第一优先 |
| 消息 ID | `data-message-id` | 去重/排序用 |
| 内容 | 用户 `.whitespace-pre-wrap`（纯文本）；助手 `.markdown.prose`（markdown 渲染）；代码块 `pre code` | |

### 滚动加载机制
- **原生虚拟化（2025 年中起逐步上线，社区确认）**：长对话 `scrollHeight` 可达 ~44000px，但 DOM 只挂载视口附近的少量消息（实测约 3 个 assistant 节点），滚动时旧节点被**驱逐**（移除 DOM）
- 采集策略（社区踩坑总结）：边滚边采，元素存活时立即记录**绝对垂直位置（offsetTop）**，最后按位置排序——否则节点被驱逐后无法恢复顺序；按 `data-message-id` 去重
- **已知 bug**：滚动过程中部分 assistant 节点渲染为空块（near-zero height、`innerText` 空），复制/导出会序列化为空字符串 → 采集需校验内容非空并触发重渲染（IntersectionObserver 回滚）

### 消息内容形态
- 用户：纯文本（可含附件/图片）；助手：markdown + 代码块；**o 系列思考过程（reasoning）折叠块在 DOM 中**（确切 testid 待实测）

### 截断风险
- **虚拟化强截断**：长对话必须滚动采集；单次 DOM 读取只能拿到视口内容

### 元数据位置
- **对话 ID**：URL `/c/{uuid}`；DOM 内 `data-message-id` / `data-testid="conversation-turn-{id}"` 亦含
- **标题**：`document.title`（公开工具普遍采用）；侧栏会话项 `data-testid="conversation-title"`（待实测）

### 来源
[awelin/Chat-Exporter](https://github.com/awelin/Chat-Exporter)、[Spider.cloud ChatGPT Scraper](https://spider.cloud/scrapers/chatgpt-scraper/)、[Greasy Fork ChatGPT Save Conversation](https://greasyfork.org/en/scripts/537648-chatgpt-save-conversation)、[dev.to: I fixed my scraper four times in one night](https://dev.to/shaojie/i-fixed-my-scraper-four-times-in-one-night-each-fix-revealed-a-worse-bug-31mf)、[OpenAI 社区: Long-thread virtualization](https://community.openai.com/t/long-thread-virtualization-empty-assistant-blocks-slow-load-chatgpt-com-web/1386500)

---

## 4. Gemini（gemini.google.com）—— 采集可行性：**中**

### URL 模式
- 对话页：`https://gemini.google.com/app/{id}`（id 为长随机字母数字串，无连字符）→ content script 匹配 `*://gemini.google.com/app/*`

### 消息块容器（公开资料）
| 角色 | 选择器 | 备注 |
|---|---|---|
| 用户消息 | 自定义元素 `user-query`（及 `.user-query` / `.query-text`） | **自定义元素比混淆 class 稳定** |
| 助手消息 | 自定义元素 `model-response`（及 `.model-response-text` / `.response-content` / `message-content`） | 同上 |
| 滚动容器 | `.conversation-container` | 含结构化内容容器（表格/图片/横向滚动块） |

- Angular 混淆 class 名**频繁变化**（ArcRift 标 Stability: Low）；自定义元素与属性（`[data-message-author="user"]`）相对稳定

### 滚动加载机制
- **虚拟化滚动容器（社区确认）**：仅视口范围内渲染，打开长对话只显示最近消息，向上滚动动态加载旧消息
- 采集策略：scroll-to-top 增量滚动 + MutationObserver 等待新节点 + 循环直至无新增

### 消息内容形态
- 用户：query 文本；助手：markdown 渲染 + 结构化组件（表格/代码/图片）
- **思考块（Thinking reasoning）在 DOM 中**，但结构复杂——Gemini Chat Exporter 明确「不导出 Thinking」→ 需专门适配（待实测）

### 截断风险
- 虚拟化截断（同上，滚动循环必需）

### 元数据位置
- **对话 ID**：URL `/app/{id}`
- **标题**：由首个 prompt 自动生成，显示于侧栏/头部（原生搜索仅匹配标题）；DOM 位置**待实测**

### 来源
[mahalel/Wide Gemini userscript](https://gist.github.com/mahalel/3f15bafdb88a2dd19e09ba38a9ee4393)（DOM 结构记录）、[Gemini Chat Exporter (AMO)](https://addons.mozilla.org/en-GB/firefox/addon/gemini-chat-exporter/)、[martymcenroe/Clio #15](https://github.com/martymcenroe/Clio/issues/15)（Gemini/Claude 提取模式）

---

## 5. Kimi（kimi.moonshot.cn）—— 采集可行性：**中~低**（DOM 脆弱，考虑内部 API）

### URL 模式
- 对话页：`https://kimi.moonshot.cn/chat/{id}`（工具 `@match *://kimi.moonshot.cn/*` 证实域内路径含 `/chat/`，确切 id 格式**待实测**）

### 消息块容器（公开资料）
| 角色 | 选择器 | 备注 |
|---|---|---|
| 消息气泡 | `.kimi-message`（`parentNode.querySelectorAll('.kimi-message')` 定位轮次） | **类名易变**：`.kimi-message-content` 已被 `.kimi-chat-bubble__content--v2` 替换 |
| data-testid | **哈希约 24h 轮换** | 不可作稳定锚点 |

- 社区结论：Kimi DOM 改版频繁，选择器脚本需 mutation 监控 + 多级 fallback；**备选路径为内部 API**：`/api/user/v6/chat/list`、`/api/user/v6/chat/message/{chat_id}`（登录态 token，扩展 background 可携带 cookie 调用）

### 滚动加载机制
- 无公开虚拟化证据（长对话默认全量渲染可能性大）；**待实测**

### 消息内容形态
- 助手 markdown 渲染 + 引用/搜索板块；**待实测**思考过程是否在 DOM

### 截断风险
- **待实测**

### 元数据位置
- **对话 ID**：URL `/chat/{id}`；内部 API `chat/message/{chat_id}` 复用同一 id
- **标题**：**待实测**（侧栏/页面标题）

### 来源
[moonshot-community/kimi-claw](https://github.com/moonshot-community/kimi-claw)（.kimi-message 机制 + 哈希轮换实测）、[conreo/kimi-chat-exporter](https://github.com/conreo/kimi-chat-exporter)（内部 API 路径）、[mr-hanlu/chatshare](https://github.com/mr-hanlu/chatshare)（通用 DOM 引擎，免维护选择器）

---

## 6. 豆包（www.doubao.com）—— 采集可行性：**中~低**（虚拟列表强截断，考虑 API hook）

### URL 模式
- 对话页：`https://www.doubao.com/chat/{id}`（旧路径 `/thread/{id}`；确切格式**待实测**）→ content script 匹配 `*://www.doubao.com/chat/*`（注意 `www.doubao.com`，移动端 `doubao.com` 为另一形态）

### 消息块容器（公开资料）
| 角色 | 选择器 | 备注 |
|---|---|---|
| 消息节点 | 带 `data-message-id` 的节点（用户问/豆包答） | 去重排序用 |
| 角色 | `.chat-message-item` 类 + `data-role` 属性 | 兜底策略：遍历 `data-role` → 关键词「你/豆包」匹配 |
| 内容 | 文本 + 图片附件（`content_block` / `content` / `tts_content` 为 API 字段） | |

### 滚动加载机制
- **虚拟列表（社区确认）**：DOM 只保留视口附近消息，`document.body.innerText` 不可靠；强制 `scrollTop=0` 触发历史加载
- 采集策略：滚动循环 + `data-message-id` 去重排序（AI导出鸭等扩展即此模式，MutationObserver + 模拟上滚）

### 消息内容形态
- 文本 + 图片附件；代码块 markdown 渲染；**待实测**思考过程

### 截断风险
- 虚拟列表强截断；**备选可靠路径**：登录态下 hook 官方接口 `POST https://www.doubao.com/im/chain/single`（`index_in_conv` 排序、`create_time` 做时间边界）——扩展在页面上下文注入 XHR/fetch hook 可拿到全量，规避 DOM 改版

### 元数据位置
- **对话 ID**：URL `/chat/{id}`；API 响应含 `message_id`/`create_time`
- **标题**：**待实测**

### 来源
[Likefr/doubao-chat-scraper](https://github.com/Likefr/doubao-chat-scraper)（API hook + 虚拟滚动实测）、cnblogs「AI导出鸭」（content script + 上滚触发虚拟列表）、[yangzh.cn: 豆包对话导出（时间边界）](https://yangzh.cn/posts/posts/doubao-chat-export-by-time.html/)、[mr-hanlu/chatshare](https://github.com/mr-hanlu/chatshare)（支持 `*.doubao.com`）

---

## 7. 通义（www.tongyi.com）—— 采集可行性：**低**（建议官方导出/API，待实测）

### URL 模式
- 统一入口：`https://www.tongyi.com/`；旧入口 `tongyi.aliyun.com/qianwen/`；国际版 `chat.qwen.ai`（基于 Open WebUI）；分享链接 `qwen.aliyun.com/share/{id}`
- **会话详情路由格式无公开文档**（如 `/chat/{id}` 与否均未证实）→ 待实测

### 消息块容器
- **无公开稳定类名**；UI 改版频繁；公开工具均改用「通用 DOM 结构分析 + 计算样式」引擎（如 ChatShare 支持 `qwen.ai/*`）识别角色，而非硬编码 class

### 滚动加载机制 / 截断风险
- **均待实测**

### 消息内容形态
- 文本/markdown 渲染；**待实测**

### 元数据位置
- 官方「数据管理 → 导出我的对话记录」：24h 内邮箱收到 ZIP（`index.html` + `record.json`，含会话 ID、role/content、timestamp）——**最可靠的官方出口，但非实时**
- LocalStorage key `conversation_*` / `history_v2`（公开资料）
- 百炼平台 API `/v1/history/list` + `/v1/history/detail`（平台级 API，非网页登录态）

### 来源
[通义网页版入口与数据导出（公开资料汇总）](https://www.tongyi.com/)、[mr-hanlu/chatshare](https://github.com/mr-hanlu/chatshare)（qwen.ai 支持）

---

## 8. 可行性结论（供 PRD §4.3 / AGENT M3 回写）

### 逐平台采集可行性（浏览器扩展，登录态）

| 平台 | 可行性 | 关键依据 | 适配要点 |
|---|---|---|---|
| **Claude** | **高** | 用户消息 `data-testid="user-message"` 多源稳定；分享页同构；无虚拟化公开证据 | ancestor-walk 定位 turn；`[data-is-streaming]` 判助手；**页面 CSP 阻止 content script 外发 fetch → 回传走 background**；长对话实测确认 |
| **DeepSeek** | **高** | `.ds-markdown` 产品前缀稳定；属性模式镜像 ChatGPT；DOM 结构有公开爬虫完整实测 | **虚拟列表必做滚动采集**（向上加载 + mutation 等待 + 去重）；>50 轮丢 ~30% 的坑 |
| **ChatGPT** | **中~高** | `data-message-author-role` 多年跨改版稳定 | **原生虚拟化**：边滚边采 + 记录 offsetTop 排序 + `data-message-id` 去重；空块 bug 需校验内容；长对话采集慢（10s+ 主线程卡顿） |
| **Gemini** | **中** | 自定义元素 `user-query`/`model-response` 较稳 | Angular class 混淆频繁，禁用 class 依赖；虚拟化滚动循环；Thinking 提取复杂 |
| **Kimi** | **中~低** | `.kimi-message` 可用但类名/哈希频繁变动 | 首选内部 API（`/api/user/v6/chat/message/{chat_id}`）或通用 DOM 引擎；DOM 采集需多级 fallback + mutation 监控 |
| **豆包** | **中~低** | `data-message-id` 节点 + `data-role` 可辨角色 | 虚拟列表强截断，必做滚动循环；**首选 hook `/im/chain/single` API**（登录态 XHR 注入） |
| **通义** | **低** | 无公开稳定选择器；路由格式未知 | 待实测后定；备选官方数据导出/本地存储解析 |

### 首批可交付平台建议

1. **Claude + DeepSeek 先行**（用户已有账号；DOM 结构公开资料最完整、采集路径最短；DeepSeek 虚拟列表为唯一主要工作量）
2. ChatGPT 作为第二批（虚拟化采集器复杂度最高，但属性稳定、社区方案成熟）
3. 豆包/Kimi/通义/Gemini 按需补充——其中**豆包、Kimi 优先评估 API hook 路径**（登录态下更稳），Gemini 走 DOM 自定义元素路径

### 通用采集架构要点（合并 Task 4 结论）

1. **content script 匹配**（manifest `matches`）：`*://claude.ai/chat/*`、`*://chat.deepseek.com/chat/*`、`*://chatgpt.com/c/*`、`*://gemini.google.com/app/*`、`*://kimi.moonshot.cn/chat/*`、`*://www.doubao.com/chat/*`、`*://www.tongyi.com/*`（通义路由待实测）
2. **SPA 路由感知**：MutationObserver + URL 变化监听（平台内切换对话不触发页面加载）
3. **虚拟列表通用采集循环**：定位滚动容器 → 滚动到顶（或底）→ 等待 mutation → 收集存活节点（记 offsetTop + 消息 id）→ 去重 → 循环至无新增 → 按 offsetTop 排序
4. **内容抽取**：角色属性（`data-message-author-role` / `data-testid`）> 类名 > 位置启发式（用户在左/助在右）三级 fallback；`role` 归一化为 `user`/`assistant`（`system`/`tool` 丢弃或标记）；代码块/思考块以 textContent 直取（折叠仅 CSS 隐藏，textContent 可读，虚拟化卸载除外）
5. **CSP 约束**：claude.ai 页面 CSP 阻止 content script 外发请求 → **数据回传统一走 background service worker**（`chrome.runtime.sendMessage`）
6. **防重**：`(user_id, platform, source_conversation_id)` 唯一约束（ARC 已有）；采集端以对话 ID 幂等
7. **思考过程开关**（产品决策）：Claude/DeepSeek/ChatGPT 的思考块均在 DOM 中可采，协议可扩展 `content` 前缀标记或独立字段（本期协议保持 `{role, content}` 不变）

### 待实测核对清单（主会话 IAB 登录态）

- [ ] Claude：长对话是否全量在 DOM；标题选择器；思考块 testid；`data-is-streaming` 是否流式结束仍保留
- [ ] DeepSeek：`/chat/{id}` id 格式；标题 DOM 位置；思考块结构；虚拟列表滚动行为实测
- [ ] ChatGPT：虚拟化下采集循环实测（空块重现率）；thinking 块 testid
- [ ] Gemini：标题位置；thinking 块结构；自定义元素当前是否仍为 `user-query`/`model-response`
- [ ] Kimi：`/chat/{id}` id 格式；长对话渲染方式；内部 API 可行性
- [ ] 豆包：`/chat/{id}` 确认；`data-role` 属性实测；`/im/chain/single` hook 可行性
- [ ] 通义：会话详情 URL 格式；消息块结构
