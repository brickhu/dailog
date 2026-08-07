// 滚动采集进度高亮：已采集消息区域加扫描高亮（注入 class + 入场动画），
// 采集结束统一清除——仅视觉提示，不改变页面布局。
// 所有平台通用（本地解析器带 el 引用的消息节点；规则兜底节点无 el 不高亮）

const HIGHLIGHT_CLASS = "dailog-scan-highlight";

let styleEl: HTMLStyleElement | null = null;

/** 确保高亮样式注入（class + 入场动画；页面无 shadow 隔离，直接挂 documentElement） */
function ensureStyle(): void {
  if (styleEl?.isConnected) return;
  styleEl = document.createElement("style");
  styleEl.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 2px solid rgba(74, 222, 128, 0.55) !important;
      outline-offset: -2px;
      border-radius: 8px;
      animation: dailog-scan-in 0.4s ease-out;
    }
    @keyframes dailog-scan-in {
      from { box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.35); }
      to { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
    }
  `;
  document.documentElement.appendChild(styleEl);
}

/** 给节点集合中带 el 引用的消息加高亮（幂等；重复读取同一节点无副作用） */
export function highlightNodes(nodes: Array<{ el?: Element }>): void {
  ensureStyle();
  for (const n of nodes) n.el?.classList.add(HIGHLIGHT_CLASS);
}

/** 取消指定节点的高亮（范围选区向下滚收缩时：已选消息移出选区，绿框消失；
 *  虚拟列表已回收的元素无操作） */
export function unhighlightNodes(nodes: Array<{ el?: Element }>): void {
  for (const n of nodes) n.el?.classList.remove(HIGHLIGHT_CLASS);
}

/** 清除全部高亮并移除注入样式（采集结束调用，恢复页面原样） */
export function clearHighlight(): void {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  styleEl?.remove();
  styleEl = null;
}
