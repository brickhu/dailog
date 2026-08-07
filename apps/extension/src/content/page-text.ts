// 最终兜底提取：整页正文文本（剔除脚本/样式/装饰节点）。
// 结构化解析（含打印模式模拟）全部失败时使用——保证内容不丢，但可能含导航等噪音，
// 由确认页按 lowConfidence 标记提示用户。

import { normalizeMessageText } from "../shared";

/** 截断上限（字符）：防止超大页面撑爆导入负载/下游管线上下文 */
const MAX_TEXT_LENGTH = 100_000;

export function extractPageText(root: ParentNode): string {
  // Document 节点的 textContent 按 DOM 规范恒为 null（clone 整个 document 会拿不到文本）——
  // 必须取 body 克隆；非 Document 根（测试）直接用自身
  const doc = root as Document;
  const source = doc.body ?? root;
  const clone = source.cloneNode(true) as ParentNode;
  clone.querySelectorAll("script, style, svg, noscript, iframe, [hidden]").forEach((el) => el.remove());
  let text = normalizeMessageText(clone.textContent ?? "");
  if (text.length > MAX_TEXT_LENGTH) {
    text = `${text.slice(0, MAX_TEXT_LENGTH)}\n\n（内容过长，已截断）`;
  }
  return text;
}
