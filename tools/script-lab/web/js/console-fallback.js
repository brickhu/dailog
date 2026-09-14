(function(){
  // 复制当前页面完整 DOM（已渲染后的真实结构）——提取/清理交给 lab 端
  var h = '<!DOCTYPE html>' + document.documentElement.outerHTML;
  var done = function () { console.log('OK 已复制完整 DOM（' + h.length + ' 字符）——回 lab 粘贴提交'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(h).then(done).catch(function () { console.log('剪贴板失败：请全选下方输出手动复制'); console.log(h); });
  } else {
    console.log(h);
  }
})();