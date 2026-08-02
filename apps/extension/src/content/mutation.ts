/** 等待 DOM 变化（滚动加载新节点后触发）；无变化则短延时后返回 */
export function waitForMutation(root: Node, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    const observer = new MutationObserver(done);
    observer.observe(root, { childList: true, subtree: true });
    function done() {
      clearTimeout(timer);
      observer.disconnect();
      resolve();
    }
  });
}
