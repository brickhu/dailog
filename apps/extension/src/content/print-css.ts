// 打印模式模拟：提取页面样式表中 @media print 块的规则，以普通规则重新注入——
// 站点（如 claude.ai）的打印样式会展开虚拟列表/滚动容器，全量渲染消息。
// 效果等同打印预览的渲染，但不需要弹打印对话框、不阻塞用户。

/** 提取所有可访问样式表里的 @media print 规则，注入为普通规则。
 *  返回清理函数（移除注入的样式元素）；跨域样式表（cssRules 不可读）跳过 */
export function applyPrintCss(doc: Document): () => void {
  const style = doc.createElement("style");
  style.dataset.dailogPrint = "true";
  let css = "";
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRule[];
    try {
      rules = Array.from(sheet.cssRules);
    } catch {
      continue; // 跨域/不可读样式表
    }
    for (const rule of rules) {
      if (rule instanceof CSSMediaRule && /print/i.test(rule.conditionText)) {
        for (const inner of Array.from(rule.cssRules)) {
          if (inner instanceof CSSStyleRule) {
            css += `${inner.selectorText}{${inner.style.cssText}}\n`;
          }
        }
      }
    }
  }
  if (css) {
    style.textContent = css;
    doc.head.appendChild(style);
  }
  return () => style.remove();
}
