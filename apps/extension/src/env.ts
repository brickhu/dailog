// 环境配置：构建时由 build.mjs 经 esbuild define 注入（process.env.DAILOGUES_*）
// 未注入（测试环境）时回退生产域名。运行时统一配置见 dist/config.json（background 启动读取）
/** 工作台（studio）基址——采集确认入库页跳转目标（config.json 缺失时的回退默认） */
export const DEFAULT_APP_BASE =
  process.env.DAILOGUES_APP_BASE ?? "https://app.dailog.fm";
/** 抓取规则固定 URL（jsDelivr CDN 托管本仓库 collect-rules.json；所有环境共用。
 *  本地解析失败时扩展从这里拉最新规则 fallback） */
export const DEFAULT_RULES_URL =
  "https://cdn.jsdelivr.net/gh/brickhu/dailog@dev/collect-rules.json";
