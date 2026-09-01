// assets.js —— 投稿详情页「生产素材 store」：编辑创作工作流的工作流输入源
// 核心原则：
//   ① 所有工作流的输入（审题/脚本/打磨/TTS/meta）都从 store 获取；
//   ② 进入投稿详情先初始化 store，3 个 R2 产出物（对话/打磨脚本/合成音频）也初始化进 store；
//   ③ 卡片预览态加载的是 R2 产出物，不从 store 加载（store 是编辑工作流用的，不是渲染缓存）。
// 存储：localStorage（key = 'assets-' + 投稿id），按提示词输出契约原样存取，不重新发明结构。

const ASSETS_PREFIX = 'assets-';

/** 读素材 store（无则 null） */
function loadAssets(id){
  try { return JSON.parse(localStorage.getItem(ASSETS_PREFIX + id) || 'null'); } catch { return null; }
}
/** 写素材 store（整体替换） */
function saveAssets(id, assets){
  try {
    assets = assets || {};
    assets.updatedAt = Date.now();
    localStorage.setItem(ASSETS_PREFIX + id, JSON.stringify(assets));
  } catch {}
}
/** 合并写（patch 浅合并进 store） */
function patchAssets(id, patch){
  const cur = loadAssets(id) || { id };
  saveAssets(id, { ...cur, ...patch });
}
/** 删除素材 store（创作完成产出物已上传/投稿删除时调用） */
function clearAssets(id){
  try { localStorage.removeItem(ASSETS_PREFIX + id); } catch {}
}

/** 初始化素材 store：进详情时调用——3 个 R2 产出物初始化进 store（索引 + 快照）。
 *  detail = /api/detail 返回的 detail 对象；dialogue = 对话数据（/api/detail 顶层返回） */
function initAssets(id, detail, dialogue){
  if (!id) return;
  const cur = loadAssets(id) || { id };
  const out = { ...cur };
  // 产出物① 对话：R2 key 由 URL 哈希推导（dialogueR2Key）；快照 = dialogue
  const srcUrl = (detail && detail.url) || null;
  if (srcUrl) out.productions = { ...(out.productions || {}), dialogue: { sourceUrl: srcUrl, cached: !!dialogue } };
  if (dialogue) out.dialogue = dialogue;
  // 产出物② 打磨脚本：快照 = detail.reviewScripts（R2 scripts）
  if (detail && Array.isArray(detail.reviewScripts)) {
    out.productions = { ...(out.productions || {}), scripts: { count: detail.reviewScripts.length, version: (out.productions && out.productions.scripts && out.productions.scripts.version || 0) + 1 } };
    // 工作流输入：脚本（打磨读的是产出物②，也作为创作面板工作流的输入源）
    out.scripts = detail.reviewScripts;
  }
  // 产出物③ 合成音频：状态从 fullmeta 索引（r2Key 存在 = 已上传）
  try {
    const fm = JSON.parse(localStorage.getItem('fullmeta-' + id) || 'null');
    if (fm) out.productions = { ...(out.productions || {}), audio: { r2Key: fm.r2Key || null, done: !!fm.done } };
  } catch {}
  // 状态快照（工作流判断用）
  if (detail && detail.status) out.status = detail.status;
  saveAssets(id, out);
  return out;
}

/** 取工作流输入（原则①：工作流输入统一从 store 取）
 *  键：selection（审题 round1 产物）/ scripts（打磨脚本）/ metadata（meta 产物） */
function getWorkflowInput(id, key){
  const a = loadAssets(id);
  return (a && a[key] !== undefined) ? a[key] : null;
}
/** 写工作流输入（提示词输出契约原样存） */
function setWorkflowInput(id, key, value){
  const cur = loadAssets(id) || { id };
  saveAssets(id, { ...cur, [key]: value });
}
