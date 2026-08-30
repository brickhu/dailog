# script-lab：通用提示词测试工具

改提示词 → 一条命令 → 拿任意输入文件跑 LLM → 看输出。无构建、无步骤专用逻辑，
**提示词放工具目录随时改，输入走文件路径**。

## 用法

```bash
# 通用形式
node tools/script-lab/run.mjs <提示词名称> --input <文件> [--input <文件>...] [选项]

# 顶层封装（推荐）：pnpm selection / draft / meta <投稿ID>——自动注入该投稿的
#   dialogue.json（自动识别形态）+ info.json（suggestion/host/guests，有则注入）
pnpm selection <投稿ID>      # = node tools/script-lab/run.mjs selection <投稿ID>
pnpm draft <投稿ID>          # = node tools/script-lab/run.mjs draft <投稿ID>
pnpm meta <投稿ID>           # = node tools/script-lab/run.mjs meta <投稿ID>
#   info.json 由 pnpm editor fetch <id> 采集时自动落盘（drafts/<id>/info.json）
#   无 info.json 时降级为只注入 dialogue；仍可叠加 --input/--note 等选项
```

- **<提示词名称>**：`tools/script-lab/prompts/` 目录下的 .md 文件名（如 `selection` / `draft` / `meta` / 你新建的任何名字），或任意 .md 文件路径
- **--input**：输入文件，可传多个；JSON 输入 + `--as <key>` → 包成信封的 `key` 字段
  （任意 JSON 形态都可以，指针即 key）；JSON 对象无 `--as` → 顶层合并；数组/文本 → 段落
- **--extract <路径>**：配合 `--as`，从 JSON 里按点路径抠出子值再放入 key（支持数组下标），
  例：`--input dialogue.json --as dialogue --extract messages` → `{"dialogue": [对话数组]}`，
  指针写「dialogue」；不 extract 则 `{"dialogue": {sourceUrl, source, messages}}`，指针写「dialogue.messages」——
  **指针必须与实际信封结构一致**（可加 `--dry-run --save-prompt` 查看最终 JSON）
- **指针约定（JSON key 优先）**：把输入组装成一个 JSON 对象（如 `{"dialogue":[...],"suggestion":"..."}`），
  user 消息就是这个 JSON；system 提示词里用 **key 名**当指针（如「dialogue」「suggestion」），
  模型按 key 从 user JSON 里取值——结构化、无文件名嵌套。
  例：`run.mjs selection --input input.json`（input.json 为上述信封）→ user 消息 = 该 JSON，
  system 里写「dialogue」即指向对话字段；多个 JSON 输入自动合并（后者覆盖同名 key）

## 示例

```bash
# 只测选题：改 prompts/selection.md 后跑
node tools/script-lab/run.mjs selection --input .dailog-editor/drafts/<id>/dialogue.json

# 注入投稿信息（嘉宾/主持人/节目建议）：dialogue + info.json 两个输入自动合并成一个信封
#   info.json = {"suggestion": "...", "host": {"callName": "飞", ...}, "guests": [{"name": "DeepSeek", ...}]}
#   selection.md 里用「suggestion」「host」「guests」作指针（已在 #1 输入说明中约定）
node tools/script-lab/run.mjs selection \
  --input .dailog-editor/drafts/<id>/dialogue.json --as dialogue \
  --input info.json

# 测脚本打磨：一个 JSON 信封（key = dialogue / idea / selection）
node tools/script-lab/run.mjs draft --input my-input.json
#   my-input.json = {"dialogue":[...],"idea":{...},"selection":{...}}

# 测元数据
node tools/script-lab/run.mjs meta --input <script.json> --input <chosen-idea.json>

# 任意提示词 + 任意数据
node tools/script-lab/run.mjs /tmp/my-prompt.md --input /tmp/data.json --note "只输出 JSON"
```

## 选项

| 选项 | 作用 |
|---|---|
| `--out <path>` | 原始输出落盘（默认 `out/<提示词>-<时间戳>.md`；输出可解析为 JSON 时另存同名 `.json`） |
| `--raw` | 终端打印完整原始输出（默认只打印流式过程 + 摘要） |
| `--dry-run` | 只拼装请求不调用 LLM——改提示词后先看请求长啥样 |
| `--save-prompt <path>` | 把拼装好的 messages 落盘，便于对比提示词改动 |
| `--note "<指令>"` | 向用户消息追加一句本次调用的附加指令（不加进提示词文件） |
| `--no-stream` | 关闭流式打印，只落盘 + 摘要 |
| `--model` `--base-url` `--api-key` `--temperature` `--max-tokens` `--seed` | 覆盖 LLM 配置（seed 用于可复现，provider 支持时生效） |

摘要会自动识别输出类型：脚本（段数/字数/情绪标签/结构校验）、选题（verdict/思路数/得分）、元数据（title/tags）、通用（顶层键）。

## 配置 LLM（一次性）

按优先级取：命令行 flag > 环境变量 > `tools/script-lab/.env` > 仓库根 `.env`。默认 DeepSeek。

```bash
cp tools/script-lab/.env.example tools/script-lab/.env
# 编辑 .env 填入 DEEPSEEK_API_KEY=sk-xxx（或 export DEEPSEEK_API_KEY=...）
```

可选：`LLM_BASE_URL` / `LLM_MODEL`（默认 `https://api.deepseek.com` / `deepseek-chat`）/ `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` / `LLM_SEED`。
  输出一致性建议：先把输入 key 和提示词指针对齐（`--as dialogue` 或信封），再 `--temperature 0.2` 左右 + `--seed 42`（固定 seed）；温度 0.4 仍会明显抖动，结构性评分/创作类字段（title、comment）波动属正常。

## 提示词（.md 正文 + .mjs 包装）

- **提示词正文写在 `prompts/*.md`**（Markdown，改完即生效，无需构建）；
  `prompts/*.mjs` 是同名包装器：默认导出 = 读取同目录 `.md` 全文，另导出 `sections` 与可选 `config`
- `node run.mjs <名称>` 时 `<名称>` 解析到 `prompts/<名称>.mjs`（也兼容任意 .md/.mjs 路径）
- `.mjs` 里可导出 `config` 定义**本环节的 LLM 配置**（可选）：
  `export const config = { temperature: 0.2, seed: 42, maxTokens: 4000 };`
  优先级：**命令行 flag > 本文件 config > 环境变量/.env > 默认（temp 0.7）**；未写的字段自动回退
- `sections` 按 `.md` 的 `#` 标题拆分，供 JS 里拼接（`import { sections } from "./prompts/selection.mjs"`）
- 仓库自带的 `selection.md` / `draft.md` / `meta.md` 是 dailog-editor 技能提示词的**副本**；
  改到满意后**同步回** `tools/dailog-editor/prompts/*.md`，再 `pnpm --filter @dailogues/dailog-editor build` 生效到技能
- 注意：`draft.md` 副本保留了生产环境的「分 3 次生成、3 次写盘」约束，单次完整测试时加
  `--note "一次输出完整 script.json，三个 parts 的 segments 全部填好，忽略分段生成要求"`
  （或直接删掉提示词里那段——这是测试台，随你改）
- 工具会自动在用户消息末尾追加一段说明：本环境**无文件读取/工具调用能力**、输入已全部内联——
  防止模型照技能提示词（面向带工具的子代理）去"用 read 读取文件"；提示词里的 read 指令可忽略
