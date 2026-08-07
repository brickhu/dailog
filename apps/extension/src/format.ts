// 展示格式化（popup / studio 待入库角标共用）

export const PLATFORM_LABEL: Record<string, string> = {
  claude: "Claude",
  deepseek: "DeepSeek",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  kimi: "Kimi",
  doubao: "豆包",
  tongyi: "通义",
  plain: "其他",
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABEL[platform] ?? platform;
}

/** 相对时间（x 分钟/小时前；超 24h 显示日期） */
export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}
