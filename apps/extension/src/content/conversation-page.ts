// 对话页判定：不依赖平台精确路径（deepseek 改版教训：/chat/ → /a/chat/s/ 让所有
// 精确规则失配）。改用对话页 URL 共同特征启发式 + DOM 对话框兜底：
// 1. URL 启发式：路径 ≥2 段且末端段是 ID 形态（6+ 位、含数字或连字符、非纯字母）
//    ——AI 平台对话页 URL 的稳定共同特征，平台改路径无需改规则
// 2. DOM 兜底：页面存在对话输入框（textarea / contenteditable，AI 对话页通用特征，
//    不会命中登录页的 input 邮箱框）——URL 拿不准时（项目页/文章 slug 等误判候选）兜底

/** URL 启发式：末端段是 ID 形态（非纯字母、含数字或连字符；排除 recents/sign_in/settings 等语义 slug） */
function isIdSegment(seg: string): boolean {
  if (!/^[A-Za-z0-9_-]{6,}$/.test(seg)) return false;
  return /[0-9-]/.test(seg);
}

/** URL 启发式判定（纯函数）：路径 ≥2 段 + 末端段是 ID */
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

/** 对话页判定：URL 启发式 OR DOM 存在对话输入框（root 缺省 = 当前文档） */
export function isConversationPage(url: string, root?: ParentNode): boolean {
  if (isConversationUrl(url)) return true;
  if (!root) return false;
  return root.querySelector(COMPOSER_SELECTOR) !== null;
}
