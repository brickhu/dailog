// 对话页判定（三条规则，AND 链）：
// 1. URL 路径层级 <3 级（域名 + path ≥3 级 = pathname ≥2 段）→ 不显示
//    （覆盖首页 1 级、登录页/新建页 2 级；注意 claude/chatgpt/豆包等对话页
//     path 实际只有 2 段，按含域名算恰好 3 级）
// 2. 末端段不是 ID 形态（6+ 位、含数字或连字符、非纯字母；只看 pathname，
//    不含 ? 后的 query 参数）→ 不显示
// 3. 通过前两条后，页面没有对话输入框 → 不显示
// 全部通过才显示 FAB——不依赖平台精确路径，平台改路径无需改规则

/** URL 启发式：末端段是 ID 形态（非纯字母、含数字或连字符；排除 recents/sign_in/settings 等语义 slug） */
function isIdSegment(seg: string): boolean {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(seg)) return false;
  return /[0-9-]/.test(seg);
}

/** 规则 1+2：路径 ≥2 段（含域名 3 级）且末端段是 ID（忽略 query/hash） */
export function isConversationUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const segs = pathname.split("/").filter(Boolean);
    return segs.length >= 2 && isIdSegment(segs[segs.length - 1]);
  } catch {
    return false;
  }
}

/** 对话输入框选择器（AI 对话页通用）：composer 通常为 textarea 或 contenteditable */
const COMPOSER_SELECTOR = 'textarea, [contenteditable="true"]';

/** 对话页判定：URL 层级/ID 特征通过 且 页面有对话输入框（规则 3；root 缺省 = 当前文档） */
export function isConversationPage(url: string, root?: ParentNode): boolean {
  if (!isConversationUrl(url)) return false;
  if (!root) return false;
  return root.querySelector(COMPOSER_SELECTOR) !== null;
}
