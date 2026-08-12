// 剪贴板链接提取（纯函数，无 UI 依赖——可单测）
// 规则 sharePattern 单一来源在 importer /platforms 端点；本函数只做 URL 提取 + 规则验证。

export interface PlatformRule { id: string; label: string; sharePattern: string }

/** 文本中的 URL（http(s) 开头，空白/引号/尖括号分隔） */
const URL_RE = /https?:\/\/[^\s<>"']+/g;
/** URL 尾部常见中文/英文标点（复制文本常带句号/括号） */
const TRAIL_PUNCT = /[，。；！？、,.;!?)\]）]+$/;

/** 从文本中找出第一个受支持的分享链接；无 → null */
export function findShareUrl(text: string, rules: PlatformRule[]): string | null {
  const urls = text.match(URL_RE) ?? [];
  for (const raw of urls) {
    const url = raw.replace(TRAIL_PUNCT, "");
    for (const r of rules) {
      try {
        if (new RegExp(r.sharePattern).test(url)) return url;
      } catch { /* 规则异常跳过 */ }
    }
  }
  return null;
}
