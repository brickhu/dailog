// merge.js —— 语音合成（浏览器端 ffmpeg.wasm）：把已生成的各段 audio 拼接为完整 m4a
// 段间间隔以「气泡表达式」配置（一行小字，点击可编辑）：
//   仅间隔：[0.5s]
//   穿插外部音频：[0.5s]+[https://example.com/a.mp3]+[0.2s]
//   解析失败 fallback：[0s]
// 背景音乐（BGM）：合成面板内可配置（URL 或本地上传 + 音量/淡入淡出），
//   启用时两段式合成：先拼干声 wav，再叠 BGM 铺底（amix，首尾音乐淡入淡出，人声不动）。
//   BGM 配置存 localStorage 'fullbgm-<id>'，文件字节存 IndexedDB key 'bgm-<id>'。
// full audio 存 IndexedDB（大文件），元数据存 localStorage；合成后配置锁定（预览态）

const FFMPEG_CDN = 'https://cdn.jsdelivr.net/npm';
let ffmpegPromise = null;   // ffmpeg.wasm 懒加载单例

// ---------- 表达式解析 ----------
function clampGapSec(v){ const n = Number.isFinite(Number(v)) ? Number(v) : 0; return Math.max(0, Math.min(10, n)); }
// "[0.5s]" → [{t:'gap',sec:0.5}]；"[0.5s]+[url]+[0.2s]" → [{gap},{audio},{gap}]；失败 → [{gap,sec:0}]
function parseGapExpr(s){
  const str = String(s || '').trim();
  if (!str) return [{ t: 'gap', sec: 0 }];
  const single = str.match(/^\[\s*([\d.]+)\s*s\s*\]$/i);
  if (single) return [{ t: 'gap', sec: clampGapSec(single[1]) }];
  const multi = str.match(/^\[\s*([\d.]+)\s*s\s*\]\s*\+\s*\[\s*(.+?)\s*\]\s*\+\s*\[\s*([\d.]+)\s*s\s*\]$/i);
  if (multi) {
    const url = multi[2].trim();
    if (/^https?:\/\/\S+$/i.test(url)) {
      return [
        { t: 'gap', sec: clampGapSec(multi[1]) },
        { t: 'audio', url },
        { t: 'gap', sec: clampGapSec(multi[3]) },
      ];
    }
  }
  return [{ t: 'gap', sec: 0 }];   // 解析失败 fallback [0s]
}
function fmtSec(sec){ return String(Number(sec).toFixed(2)).replace(/\.?0+$/, '') || '0'; }
// 操作序列 → 表达式文本（气泡显示）
function formatGapExpr(seq){
  const parts = (seq || []).map(p => p.t === 'gap' ? '[' + fmtSec(p.sec) + 's]' : '[' + p.url + ']');
  return parts.length ? parts.join('+') : '[0s]';
}
function defaultGapExpr(){ return '[0.5s]'; }

// ---------- 间隔配置持久（localStorage，按投稿） ----------
function loadGapExprs(id, segCount){
  let list = null;
  try { list = JSON.parse(localStorage.getItem('fullgap-' + id) || 'null'); } catch {}
  if (!Array.isArray(list)) list = [];
  const n = Math.max(0, (Number(segCount) || 0) - 1);
  while (list.length < n) list.push(defaultGapExpr());
  return list.slice(0, n);
}
function saveGapExprs(id, list){ try { localStorage.setItem('fullgap-' + id, JSON.stringify(list)); } catch {} }

// ---------- BGM 背景音乐配置：持久化（localStorage 配置 + IndexedDB 文件字节） ----------
// 配置形如：{ enabled:true, vol:0.15, fadeIn:3, fadeOut:4, src:{kind:'url',url} | {kind:'file',file:{name,size}} }
function loadBgmConfig(id){ try { return JSON.parse(localStorage.getItem('fullbgm-' + id) || 'null') || {}; } catch { return {}; } }
function saveBgmConfig(id, cfg){ try { localStorage.setItem('fullbgm-' + id, JSON.stringify(cfg || {})); } catch {} }
function bgmSummary(cfg){
  if (!cfg || !cfg.enabled) return null;
  return { vol: cfg.vol, fadeIn: cfg.fadeIn, fadeOut: cfg.fadeOut, kind: (cfg.src && cfg.src.kind) || null };
}
async function bgmBytesSave(id, bytes){
  const db = await idbOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction('audios', 'readwrite');
    tx.objectStore('audios').put(bytes, 'bgm-' + id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error || new Error('BGM 写入失败'));
  });
}
async function bgmBytesLoad(id){
  const db = await idbOpen();
  return await new Promise((res, rej) => {
    const rq = db.transaction('audios', 'readonly').objectStore('audios').get('bgm-' + id);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error || new Error('BGM 读取失败'));
  });
}
async function bgmBytesDelete(id){
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('audios', 'readwrite');
      tx.objectStore('audios').delete('bgm-' + id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error || new Error('BGM 删除失败'));
    });
  } catch {}
}
function fmtSize(n){
  n = Number(n) || 0;
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  if (n >= 1024) return Math.round(n / 1024) + 'KB';
  return n + 'B';
}
function bytesToBase64(bytes){
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ---------- 气泡渲染 / 编辑 ----------
function gapBubbleHtml(id, si, segi, expr){
  return "<div class='gap-bubble' data-si='" + si + "' data-segi='" + segi + "' onclick='editGapBubble(\"" + id + "\", " + si + ", " + segi + ")' title='点击编辑该处间隔（0-10s，可穿插音频 URL）'>" + esc(expr) + "</div>";
}
function editGapBubble(id, si, segi){
  const el = document.querySelector('.gap-bubble[data-si="' + si + '"][data-segi="' + segi + '"]');
  if (!el || el.dataset.editing) return;
  const segCount = document.querySelectorAll('.seg-row[data-si="' + si + '"]').length;
  const list = loadGapExprs(id, segCount);
  el.dataset.editing = '1';
  el.innerHTML = "<input class='gap-input' spellcheck='false' value='" + esc(list[segi] || defaultGapExpr()) + "' onkeydown='if(event.key===\"Enter\")this.blur()' onblur='commitGapExpr(\"" + id + "\", " + si + ", " + segi + ", this.value)'>";
  const inp = el.querySelector('input');
  inp.focus(); inp.select();
}
function commitGapExpr(id, si, segi, raw){
  const el = document.querySelector('.gap-bubble[data-si="' + si + '"][data-segi="' + segi + '"]');
  const expr = formatGapExpr(parseGapExpr(raw));   // 解析失败 → [0s]
  const segCount = document.querySelectorAll('.seg-row[data-si="' + si + '"]').length;
  const list = loadGapExprs(id, segCount);
  list[segi] = expr;
  saveGapExprs(id, list);
  if (el) { el.dataset.editing = ''; el.innerHTML = esc(expr); }
}

// ---------- full audio：IndexedDB（大文件）+ 元数据 localStorage ----------
let idbPromise = null;
function idbOpen(){
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((res, rej) => {
    const r = indexedDB.open('dailog-full-audio', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('audios'); } catch {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error || new Error('IndexedDB 打开失败'));
  });
  return idbPromise;
}
async function fullAudioSave(id, blob){
  const db = await idbOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction('audios', 'readwrite');
    tx.objectStore('audios').put(blob, 'full-' + id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error || new Error('full audio 写入失败'));
  });
}
async function fullAudioLoad(id){
  const db = await idbOpen();
  return await new Promise((res, rej) => {
    const rq = db.transaction('audios', 'readonly').objectStore('audios').get('full-' + id);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error || new Error('full audio 读取失败'));
  });
}
function loadFullMeta(id){ try { return JSON.parse(localStorage.getItem('fullmeta-' + id) || 'null'); } catch { return null; } }
function saveFullMeta(id, meta){ try { localStorage.setItem('fullmeta-' + id, JSON.stringify(meta)); } catch {} }

// ---------- ffmpeg.wasm 懒加载 ----------
function base64ToBytes(b64){
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
async function loadFFmpeg(){
  if (ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    // 跨域隔离检测：多线程 core 需要 SharedArrayBuffer（lab server 需重启使 COOP/COEP 头生效）
    let sabOk = false;
    try { sabOk = typeof SharedArrayBuffer !== 'undefined' && !!new SharedArrayBuffer(4); } catch {}
    if (!sabOk) throw new Error('浏览器跨域隔离未生效（SharedArrayBuffer 不可用）——请完全关闭并重新打开 lab 页面（Cmd+Shift+R 硬刷新）；若仍不行请确认 lab 是直接浏览器打开而非嵌入 iframe（COOP 对 iframe 不生效）');
    if (!window.FFmpeg) throw new Error('ffmpeg.wasm 未加载（/vendor/ffmpeg-0.11.js）');
    const ffmpeg = window.FFmpeg.createFFmpeg({
      // 多线程 core（lab 已配 COOP/COEP 跨域隔离，SharedArrayBuffer 可用）
      corePath: FFMPEG_CDN + '/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      log: false,
    });
    await ffmpeg.load();
    return ffmpeg;
  })();
  return ffmpegPromise;
}

// ---------- 合成主流程 ----------
// 拼接列表项：{ name }（段，已 writeFile）| { gapSec, name } | { introUrl, name }
async function mergeSegAudio(id, si){
  const btn = document.querySelector('.seg-merge-btn[data-si="' + si + '"]');
  const setBusy = (busy, label) => {
    if (!btn) return;
    btn.disabled = busy;
    btn.textContent = busy ? (label || '合成中...') : '🎬 语音合成';
  };
  try {
    const d = await j('/api/detail/' + id);
    const script = ((d.prodSummary && d.prodSummary.scriptList) || [])[si];
    if (!script || !Array.isArray(script.segments) || !script.segments.length) { notice('脚本为空，无法合成', 'error'); return; }
    const segs = script.segments;
    // 全量 audio 校验
    const audios = segs.map(seg => segAudioGet(segKey(id, seg)));
    for (let i = 0; i < audios.length; i++) {
      if (!audios[i]) { notice('第 ' + (i + 1) + ' 段尚无语音，请先生成', 'error'); return; }
    }
    // 拼接序列：段 + 间隔操作
    const gapList = loadGapExprs(id, segs.length);
    const inputs = [];       // {name, data} 需 writeFile 的
    const seq = [];          // 顺序：{name} | {gapSec, name} | {introUrl, name}
    for (let i = 0; i < segs.length; i++) {
      const nm = 'seg' + i + '.mp3';
      inputs.push({ name: nm, data: base64ToBytes(audios[i].audio) });
      seq.push({ name: nm });
      if (i < segs.length - 1) {
        const ops = parseGapExpr(gapList[i]);
        ops.forEach((op, oi) => {
          const tag = 'gap' + i + '_' + oi;
          if (op.t === 'gap') seq.push({ gapSec: op.sec, name: tag + '.mp3' });
          else seq.push({ introUrl: op.url, name: tag + '.mp3' });
        });
      }
    }
    setBusy(true, '加载引擎...');
    const ffmpeg = await loadFFmpeg();
    setBusy(true, '拼接 ' + segs.length + ' 段...');
    // 清理上次合成残留（0.11 FS writeFile 同名会报 EEXIST）
    ['_list.txt', 'final.m4a'].concat(inputs.map(i => i.name)).forEach(n => { try { ffmpeg.FS('unlink', n); } catch {} });
    for (const it of inputs) ffmpeg.FS('writeFile', it.name, it.data);
    const listLines = [];
    for (const s of seq) {
      if (s.gapSec !== undefined) {
        await ffmpeg.run('-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(s.gapSec), '-c:a', 'libmp3lame', '-q:a', '9', s.name);
        listLines.push("file '" + s.name + "'");
      } else if (s.introUrl) {
        const resp = await fetch(s.introUrl);
        if (!resp.ok) throw new Error('intro 音频下载失败: ' + s.introUrl + '（需目标允许跨域）');
        ffmpeg.FS('writeFile', s.name, new Uint8Array(await resp.arrayBuffer()));
        listLines.push("file '" + s.name + "'");
      } else {
        listLines.push("file '" + s.name + "'");
      }
    }
    ffmpeg.FS('writeFile', '_list.txt', new TextEncoder().encode(listLines.join('\n')));
    await ffmpeg.run('-y', '-f', 'concat', '-safe', '0', '-i', '_list.txt', '-c:a', 'aac', '-b:a', '128k', 'final.m4a');
    const out = ffmpeg.FS('readFile', 'final.m4a');
    if (!out || !out.length) throw new Error('合成结果为空');
    const blob = new Blob([out.buffer], { type: 'audio/mp4' });
    await fullAudioSave(id, blob);
    saveFullMeta(id, {
      at: Date.now(), size: blob.size, scriptIndex: si, segCount: segs.length,
      gaps: gapList, scriptName: script.title || null,
    });
    // 上传 R2 持久化（full/{id}.m4a；失败不阻断预览态，fullmeta 不记 r2Key）
    let r2Note = '';
    try {
      const b64 = await blobToBase64(blob);
      const up = await j('/api/run/full-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, audio: b64 }) });
      if (up && up.ok && up.key) {
        const meta = loadFullMeta(id);
        if (meta) { meta.r2Key = up.key; saveFullMeta(id, meta); }
        r2Note = ' · 已上传 R2';
      } else { r2Note = ' · ⚠ R2 上传失败'; }
    } catch (e) { r2Note = ' · ⚠ R2 上传失败: ' + e.message; }
    // 锁定配置（合成后不可改序列/间隔/intro）→ 切预览态
    notice('✓ 语音合成完成 ' + segs.length + ' 段 → full audio（' + (blob.size / 1024 / 1024).toFixed(1) + 'MB）' + r2Note, 'success');
    openDetail(id);
  } catch (e) {
    setBusy(false);
    notice('✗ 语音合成失败: ' + e.message, 'error');
  }
}


// Blob → base64（R2 上传用）
function blobToBase64(blob){
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

// ---------- 合成按钮状态 / seg 缓存预加载 ----------
// 更新「语音合成」按钮可用态（生成/打磨/保存后调用；按 DOM 实际缓存检查）
function updateMergeBtn(id, si){
  const btn = document.querySelector('.seg-merge-btn[data-si="' + si + '"]');
  if (!btn) return;
  const rows = [...document.querySelectorAll('.seg-row[data-si="' + si + '"]')];
  const allReady = rows.length > 0 && rows.every(row => {
    const k = row && row.dataset.segkey;
    return !!k && !!segAudioGet(k);
  });
  btn.disabled = !allReady;
  btn.title = allReady ? '拼接全部段为完整 m4a' : '需全部段生成语音后才可合成';
}

// 预加载该投稿全部 seg 语音缓存（IndexedDB → 内存）：segAudioGet 是同步的，渲染前先批量读入内存
async function preloadSegAudioCache(id, scripts){
  const keys = [];
  (scripts || []).forEach(s => (s.segments || []).forEach(seg => {
    try { keys.push(segKey(id, seg)); } catch {}
  }));
  if (!keys.length) return;
  try {
    const db = await idbOpen();
    const store = db.transaction('audios', 'readonly').objectStore('audios');
    const got = await Promise.all(keys.map(k => new Promise(res => {
      const rq = store.get('seg-audio-' + k);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    })));
    got.forEach((v, i) => { if (v) segAudioCache[keys[i]] = v; });
  } catch {}
}



// ---------- 过期语音缓存惰性清理 ----------
// 生成语音时清除 IndexedDB 中过期的 seg 语音缓存（5 小时有效；full- 定稿音频不参与）
const SEG_AUDIO_TTL = 5 * 60 * 60 * 1000;   // 5h
async function clearExpiredSegAudio(){
  try {
    const db = await idbOpen();
    const tx = db.transaction('audios', 'readwrite');
    const store = tx.objectStore('audios');
    const keys = await new Promise(res => { const rq = store.getAllKeys(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); });
    const now = Date.now();
    const expired = [];
    for (const k of keys) {
      if (typeof k !== 'string' || !k.startsWith('seg-audio-')) continue;
      const v = await new Promise(res => { const rq = store.get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); });
      if (v && typeof v.at === 'number' && (now - v.at) > SEG_AUDIO_TTL) expired.push(k);
    }
    expired.forEach(k => store.delete(k));
    // 同步清内存（内存 key = IndexedDB key 去掉 seg-audio- 前缀）
    expired.forEach(k => { delete segAudioCache[k.slice('seg-audio-'.length)]; });
    if (expired.length) console.log('[cache] 惰性清除过期语音缓存 ' + expired.length + ' 条');
  } catch {}
}



// ---------- 预览态补救：重新上传 R2 / 重新合成 ----------
// 删除 IndexedDB 中的 full audio
async function fullAudioDelete(id){
  const db = await idbOpen();
  await new Promise((res, rej) => {
    const tx = db.transaction('audios', 'readwrite');
    tx.objectStore('audios').delete('full-' + id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error || new Error('删除失败'));
  });
}
// 预览态：重新上传 R2（合成成功但上传失败时，从 IndexedDB 读本地副本重传）
async function retryFullUpload(id){
  const blob = await fullAudioLoad(id);
  if (!blob) { notice('本地 full audio 不存在——请先「重新合成」', 'error'); return; }
  try {
    const b64 = await blobToBase64(blob);
    const up = await j('/api/run/full-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, audio: b64 }) });
    if (up && up.ok && up.key) {
      const meta = loadFullMeta(id);
      if (meta) { meta.r2Key = up.key; saveFullMeta(id, meta); }
      notice('✓ 已上传 R2（' + up.key + '）', 'success');
      openDetail(id);
    } else { notice('✗ R2 上传失败', 'error'); }
  } catch (e) { notice('✗ R2 上传失败: ' + e.message, 'error'); }
}
// 预览态：清除 full audio（IndexedDB + 元数据）→ 回创作态可改配置重新合成
async function resetFullAudio(id){
  try { await fullAudioDelete(id); } catch {}
  try { localStorage.removeItem('fullmeta-' + id); } catch {}
  openDetail(id);
}



// ---------- 音频合成对话框（config → loading → preview → uploading） ----------
let mergeCtx = null;        // { id, si, bgm }
let mergeMode = 'closed';   // closed | config | loading | preview | uploading

function setMergeMode(mode){
  mergeMode = mode;
  const title = document.getElementById('mergeTitle');
  const closeBtn = document.getElementById('mergeCloseBtn');
  const loading = document.getElementById('mergeLoading');
  const config = document.getElementById('mergeConfig');
  const preview = document.getElementById('mergePreview');
  const confirmBtn = document.getElementById('mergeConfirmBtn');
  const remergeBtn = document.getElementById('mergeRemergeBtn');
  if (mode === 'config') {
    if (title) title.textContent = '音频合成';
    if (closeBtn) closeBtn.style.display = '';              // 可关闭（放弃本次）
    if (loading) loading.style.display = 'none';
    if (config) config.style.display = 'block';
    if (preview) preview.style.display = 'none';
  } else if (mode === 'loading') {
    if (title) title.textContent = '音频合成中…';
    if (closeBtn) closeBtn.style.display = 'none';          // 禁止关闭
    if (loading) loading.style.display = 'block';
    if (config) config.style.display = 'none';
    if (preview) preview.style.display = 'none';
  } else if (mode === 'preview') {
    if (title) title.textContent = '音频已合成';
    if (closeBtn) closeBtn.style.display = '';              // 可关闭
    if (loading) loading.style.display = 'none';
    if (config) config.style.display = 'none';
    if (preview) preview.style.display = 'block';
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    if (remergeBtn) { remergeBtn.disabled = false; remergeBtn.textContent = '重新合成'; }
  } else if (mode === 'uploading') {
    if (title) title.textContent = '正在上传…';
    if (closeBtn) closeBtn.style.display = 'none';          // 禁止关闭
    if (loading) loading.style.display = 'none';
    if (config) config.style.display = 'none';
    if (preview) preview.style.display = 'block';
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '上传中…'; }
    if (remergeBtn) remergeBtn.disabled = true;
  }
}
function setMergeStep(pct, text){
  const bar = document.getElementById('mergeBar');
  const step = document.getElementById('mergeStepText');
  if (bar) bar.style.width = pct + '%';
  if (step) step.textContent = text || '';
}

// 合成主体（对话框模式）：收集段音频 → ffmpeg 拼接 → （可选铺 BGM）→ IndexedDB 暂存 → 返回 blob
async function runMergeConcat(){
  const { id, si } = mergeCtx;
  const bgmCfg = (mergeCtx.bgm && mergeCtx.bgm.enabled) ? mergeCtx.bgm : null;   // 本次合成生效的 BGM
  setMergeStep(5, '读取脚本…');
  const d = await j('/api/detail/' + id);
  const script = ((d.prodSummary && d.prodSummary.scriptList) || [])[si];
  if (!script || !Array.isArray(script.segments) || !script.segments.length) throw new Error('脚本为空，无法合成');
  const segs = script.segments;
  const audios = segs.map(seg => segAudioGet(segKey(id, seg)));
  for (let i = 0; i < audios.length; i++) {
    if (!audios[i]) throw new Error('第 ' + (i + 1) + ' 段尚无语音，请先生成');
  }
  const gapList = loadGapExprs(id, segs.length);
  // 无跨域隔离（SAB 不可用）→ 自动降级服务端 ffmpeg 合并（不依赖浏览器 Wasm）
  if (!sabAvailable()) {
    return runServerMerge(id, si, script, audios, gapList, bgmCfg);
  }
  const inputs = [];
  const seq = [];
  for (let i = 0; i < segs.length; i++) {
    const nm = 'seg' + i + '.mp3';
    inputs.push({ name: nm, data: base64ToBytes(audios[i].audio) });
    seq.push({ name: nm });
    if (i < segs.length - 1) {
      const ops = parseGapExpr(gapList[i]);
      ops.forEach((op, oi) => {
        const tag = 'gap' + i + '_' + oi;
        if (op.t === 'gap') seq.push({ gapSec: op.sec, name: tag + '.mp3' });
        else seq.push({ introUrl: op.url, name: tag + '.mp3' });
      });
    }
  }
  setMergeStep(12, '加载合成引擎…');
  const ffmpeg = await loadFFmpeg();
  // 清理上次合成残留（FS writeFile 同名会报 EEXIST）
  ['_list.txt', 'final.m4a', 'dry.wav', 'bgm0.bin'].concat(inputs.map(i => i.name)).forEach(n => { try { ffmpeg.FS('unlink', n); } catch {} });
  setMergeStep(25, '写入音频片段…');
  for (const it of inputs) ffmpeg.FS('writeFile', it.name, it.data);
  setMergeStep(45, '处理间隔与 intro…');
  const listLines = [];
  for (const s of seq) {
    if (s.gapSec !== undefined) {
      await ffmpeg.run('-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(s.gapSec), '-c:a', 'libmp3lame', '-q:a', '9', s.name);
      listLines.push("file '" + s.name + "'");
    } else if (s.introUrl) {
      const resp = await fetch(s.introUrl);
      if (!resp.ok) throw new Error('intro 音频下载失败: ' + s.introUrl + '（需目标允许跨域）');
      ffmpeg.FS('writeFile', s.name, new Uint8Array(await resp.arrayBuffer()));
      listLines.push("file '" + s.name + "'");
    } else {
      listLines.push("file '" + s.name + "'");
    }
  }
  ffmpeg.FS('writeFile', '_list.txt', new TextEncoder().encode(listLines.join('\n')));
  if (bgmCfg) {
    // 第 1 段：干声 → 无损中间轨（44100 mono，保证 amix 声道/采样率一致）
    setMergeStep(70, '拼接干声…');
    await ffmpeg.run('-y', '-f', 'concat', '-safe', '0', '-i', '_list.txt', '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', 'dry.wav');
    setMergeStep(80, '准备背景音乐…');
    // BGM 来源：URL（浏览器 fetch，需 CORS）或本地上传（IndexedDB 字节）
    let bgmBytes = null;
    if (bgmCfg.src && bgmCfg.src.kind === 'file') {
      bgmBytes = await bgmBytesLoad(id);
      if (!bgmBytes || !bgmBytes.length) throw new Error('本地 BGM 文件缺失——请重新选择音乐文件');
    } else if (bgmCfg.src && bgmCfg.src.url) {
      const resp = await fetch(bgmCfg.src.url);
      if (!resp.ok) throw new Error('BGM 下载失败: ' + bgmCfg.src.url + '（需目标允许跨域）');
      bgmBytes = new Uint8Array(await resp.arrayBuffer());
    }
    if (!bgmBytes || !bgmBytes.length) throw new Error('BGM 内容为空');
    ffmpeg.FS('writeFile', 'bgm0.bin', bgmBytes);
    // 干声时长 → 淡出定位（浏览器解码 wav 取 duration）
    const dryBytes = ffmpeg.FS('readFile', 'dry.wav');
    const dur = await audioDurationOf(dryBytes, 'audio/wav');
    if (!dur) throw new Error('无法读取干声时长');
    setMergeStep(88, '混入背景音乐…');
    await ffmpeg.run('-y', '-i', 'dry.wav', '-stream_loop', '-1', '-i', 'bgm0.bin',
      '-filter_complex', bgmMixFilter(bgmCfg, dur), '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', 'final.m4a');
  } else {
    setMergeStep(75, '拼接编码中…');
    await ffmpeg.run('-y', '-f', 'concat', '-safe', '0', '-i', '_list.txt', '-c:a', 'aac', '-b:a', '128k', 'final.m4a');
  }
  setMergeStep(92, '生成成品…');
  const out = ffmpeg.FS('readFile', 'final.m4a');
  if (!out || !out.length) throw new Error('合成结果为空');
  const blob = new Blob([out.buffer], { type: 'audio/mp4' });
  await fullAudioSave(id, blob);
  saveFullMeta(id, { at: Date.now(), size: blob.size, scriptIndex: si, segCount: segs.length, gaps: gapList, scriptName: script.title || null, bgm: bgmSummary(bgmCfg) });
  const player = document.getElementById('mergePlayer');
  if (player) player.src = URL.createObjectURL(blob);
  return blob;
}

// ---------- 合成面板 BGM 配置区：面板读写 ----------
function bgmPanelEls(){
  return {
    enable: document.getElementById('bgmEnable'),
    fields: document.getElementById('bgmFields'),
    url: document.getElementById('bgmUrl'),
    file: document.getElementById('bgmFile'),
    fileInfo: document.getElementById('bgmFileInfo'),
    fileClear: document.getElementById('bgmFileClear'),
    vol: document.getElementById('bgmVol'),
    volLabel: document.getElementById('bgmVolLabel'),
    fadeIn: document.getElementById('bgmFadeIn'),
    fadeOut: document.getElementById('bgmFadeOut'),
  };
}
// 用持久化配置回填面板（每次打开面板 / 预览返回时调用）
function fillBgmPanel(id){
  const el = bgmPanelEls();
  if (!el.enable) return;
  const cfg = loadBgmConfig(id) || {};
  el.enable.checked = !!cfg.enabled;
  el.fields.style.display = el.enable.checked ? 'block' : 'none';
  el.url.value = (cfg.src && cfg.src.kind === 'url') ? (cfg.src.url || '') : '';
  clearBgmFileUi();
  if (cfg.enabled && cfg.src && cfg.src.kind === 'file' && cfg.src.file) {
    el.file.dataset.src = JSON.stringify(cfg.src.file);
    el.fileInfo.textContent = '已选 ' + cfg.src.file.name + '（' + fmtSize(cfg.src.file.size) + '）';
    el.fileClear.style.display = '';
  }
  el.vol.value = cfg.vol != null ? cfg.vol : 0.15;
  if (el.volLabel) el.volLabel.textContent = Math.round(Number(el.vol.value) * 100) + '%';
  el.fadeIn.value = cfg.fadeIn != null ? cfg.fadeIn : 3;
  el.fadeOut.value = cfg.fadeOut != null ? cfg.fadeOut : 4;
}
function clearBgmFileUi(){
  const el = bgmPanelEls();
  if (!el.file) return;
  delete el.file.dataset.src;
  el.file.value = '';
  if (el.fileInfo) el.fileInfo.textContent = '';
  if (el.fileClear) el.fileClear.style.display = 'none';
}
// 面板 → 配置对象；未启用返回 {enabled:false}；启用但无来源返回 null（校验用）
function readBgmPanelConfig(){
  const el = bgmPanelEls();
  if (!el.enable || !el.enable.checked) return { enabled: false };
  const vol = Math.min(0.4, Math.max(0.02, Number(el.vol.value) || 0.15));
  const fadeIn = Math.min(15, Math.max(0, Number(el.fadeIn.value) || 0));
  const fadeOut = Math.min(15, Math.max(0, Number(el.fadeOut.value) || 0));
  const url = String(el.url.value || '').trim();
  const fileMeta = el.file && el.file.dataset.src ? (JSON.parse(el.file.dataset.src) || null) : null;
  const cfg = { enabled: true, vol, fadeIn, fadeOut };
  if (fileMeta && fileMeta.name) cfg.src = { kind: 'file', file: fileMeta };          // 文件优先
  else if (url) cfg.src = { kind: 'url', url };                                        // 否则 URL
  else return null;                                                                     // 启用但无来源
  return cfg;
}
function onBgmEnableToggle(){
  const el = bgmPanelEls();
  if (el.fields) el.fields.style.display = el.enable.checked ? 'block' : 'none';
}
function onBgmVol(){
  const el = bgmPanelEls();
  if (el.volLabel) el.volLabel.textContent = Math.round(Number(el.vol.value) * 100) + '%';
}
async function onBgmFile(input){
  if (!mergeCtx || !input || !input.files || !input.files[0]) return;
  const f = input.files[0];
  const buf = await f.arrayBuffer();
  await bgmBytesSave(mergeCtx.id, new Uint8Array(buf));
  const el = bgmPanelEls();
  el.file.dataset.src = JSON.stringify({ name: f.name, size: f.size });
  el.url.value = '';                       // 文件与 URL 互斥：选文件后清 URL
  el.fileInfo.textContent = '已选 ' + f.name + '（' + fmtSize(f.size) + '）';
  el.fileClear.style.display = '';
  el.enable.checked = true;
  el.fields.style.display = 'block';
}
async function clearBgmFile(){
  const el = bgmPanelEls();
  clearBgmFileUi();
  if (mergeCtx) await bgmBytesDelete(mergeCtx.id);   // 清除 IndexedDB 字节，防串期
}

// ---------- BGM 混音滤镜（Wasm 与服务端同一套语义） ----------
// 两段式：干声 dry.wav(44100 mono) + BGM(stream_loop 无限循环) → amix(duration=first)
//   音乐淡入/淡出只作用于 BGM 链（人声全程不动）；输出 44100 mono m4a，与无 BGM 时声道一致
function fmtNum(n){ return String(Math.round(Number(n) * 1000) / 1000); }
function bgmMixFilter(cfg, durSec){
  const T = Math.max(0.1, Number(durSec) || 0);
  const vol = Math.min(0.4, Math.max(0.02, Number(cfg.vol) || 0.15));
  let fadeIn = Math.min(15, Math.max(0, Number(cfg.fadeIn) || 0));
  let fadeOut = Math.min(15, Math.max(0, Number(cfg.fadeOut) || 0));
  if (fadeIn >= T) fadeIn = 0;      // 整轨比淡入还短 → 关淡入
  if (fadeOut >= T) fadeOut = 0;    // 同上 → 关淡出
  let bg = '[1:a]aformat=sample_rates=44100:channel_layouts=mono,volume=' + fmtNum(vol);
  if (fadeIn > 0) bg += ',afade=t=in:st=0:d=' + fmtNum(fadeIn);
  if (fadeOut > 0) bg += ',afade=t=out:st=' + fmtNum(T - fadeOut) + ':d=' + fmtNum(fadeOut);
  bg += '[bg]';
  // normalize=0：amix 默认会按输入数归一化（人声减半），必须关掉让人声 1:1 保留
  return '[0:a]aformat=sample_rates=44100:channel_layouts=mono[a0];' + bg + ';[a0][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]';
}
// 用浏览器解码读音频字节时长（淡出定位用）
function audioDurationOf(bytes, mime){
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/wav' }));
    const a = new Audio();
    a.onloadedmetadata = () => { URL.revokeObjectURL(u); res(Number.isFinite(a.duration) ? a.duration : 0); };
    a.onerror = () => { URL.revokeObjectURL(u); rej(new Error('无法读取音频时长（浏览器解码失败）')); };
    a.src = u;
  });
}
// 服务端兜底参数：把面板配置序列化为 full-merge body.bgm（文件 → base64 走 IDB 字节）
async function bgmForServer(id, cfg){
  if (!cfg || !cfg.enabled) return null;
  const b = { vol: cfg.vol, fadeIn: cfg.fadeIn, fadeOut: cfg.fadeOut };
  if (cfg.src && cfg.src.kind === 'file') {
    const bytes = await bgmBytesLoad(id);
    if (!bytes || !bytes.length) throw new Error('本地 BGM 文件缺失（IndexedDB）——请重新选择音乐文件');
    b.kind = 'file';
    b.dataBase64 = bytesToBase64(bytes);
  } else if (cfg.src && cfg.src.url) {
    b.kind = 'url';
    b.url = cfg.src.url;
  } else return null;
  return b;
}

// ---------- 打开合成对话框（先配置 BGM，再开始合成） ----------
async function openMergeDialog(id, si){
  if (mergeMode !== 'closed') return;
  mergeCtx = { id, si, bgm: loadBgmConfig(id) };
  // 停止预览音频播放并释放资源
  const player = document.getElementById('mergePlayer');
  if (player) { try { player.pause(); } catch {} player.src = ''; player.load(); }
  const overlay = document.getElementById('mergeModal');
  if (overlay) overlay.style.display = 'flex';
  setMergeMode('config');
  fillBgmPanel(id);
  // 面板信息行：显示脚本/段数（拉详情，失败不阻断）
  const info = document.getElementById('mergeConfigInfo');
  if (info) info.textContent = '读取脚本…';
  try {
    const d = await j('/api/detail/' + id);
    const script = ((d.prodSummary && d.prodSummary.scriptList) || [])[si];
    const n = (script && script.segments) ? script.segments.length : 0;
    if (info) info.textContent = (n ? '第 ' + (si + 1) + ' 个脚本 · ' + n + ' 段语音已就绪' : '脚本为空，无法合成') + '，可配置背景音乐后开始';
  } catch { if (info) info.textContent = ''; }
}
// 配置面板：开始合成
async function startMergeFromConfig(){
  if (mergeMode !== 'config' || !mergeCtx) return;
  const cfg = readBgmPanelConfig();
  if (cfg === null) { notice('已勾选背景音乐，请填写音乐 URL 或选择本地音乐文件', 'error'); return; }
  saveBgmConfig(mergeCtx.id, cfg);
  mergeCtx.bgm = cfg;
  setMergeMode('loading');
  try {
    await runMergeConcat();
    setMergeMode('preview');
    setMergeBgmNote();
  } catch (e) {
    setMergeMode('config');              // 失败回配置面板可调整后重试
    notice('✗ 语音合成失败: ' + e.message, 'error');
  }
}
// 预览态：重新合成 → 回配置面板（可改 BGM 再跑）
function remergeAudio(){
  if (mergeMode !== 'preview' || !mergeCtx) return;
  setMergeMode('config');
  fillBgmPanel(mergeCtx.id);
}
// 预览 note：本次用了什么 BGM（音量/淡入淡出）
function setMergeBgmNote(){
  const note = document.getElementById('mergeBgmNote');
  if (!note || !mergeCtx) return;
  const s = bgmSummary(mergeCtx.bgm);
  note.textContent = s
    ? '🎵 已铺背景音乐 · 音量 ' + Math.round(Number(s.vol) * 100) + '% · 淡入 ' + (s.fadeIn || 0) + 's / 淡出 ' + (s.fadeOut || 0) + 's · 来源 ' + (s.kind === 'file' ? '本地文件' : 'URL')
    : '';
}
// 预览态：确认 → 上传 R2（uploading 态禁关闭）→ 成功清缓存 + 触发创作完成
async function confirmMergeUpload(){
  if (mergeMode !== 'preview') return;
  const { id } = mergeCtx;
  setMergeMode('uploading');
  try {
    const blob = await fullAudioLoad(id);
    if (!blob) throw new Error('本地 full audio 不存在');
    const b64 = await blobToBase64(blob);
    const up = await j('/api/run/full-upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, audio: b64 }) });
    if (!(up && up.ok)) throw new Error('R2 上传失败');
    // 服务端 crafted 标记双保险：full-upload 已尝试，失败则前端再补一次
    if (!(up && up.crafted)) {
      try { await j('/api/run/mark-crafted', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); } catch {}
    }
    // 成功：记录 r2Key + done，清浏览器缓存（seg 片段 + full——播放走 R2）
    const meta = loadFullMeta(id) || {};
    meta.r2Key = up.key || ('full/' + id + '.m4a');
    meta.done = true;
    saveFullMeta(id, meta);
    // 共享工作流状态：发布步直接复用该 audioKey（免重传音频）
    try { if (window.workflowState) window.workflowState.audioKey = meta.r2Key; } catch {}
    // 素材清除时机 = 节目发布后（published）——crafted 后可能改脚本/重新生成 meta，素材保留
    closeMergeModal(true, true);   // 确认成功：强制关闭
    if (typeof onMergeDone === 'function') onMergeDone(id);
  } catch (e) {
    setMergeMode('preview');   // 失败回预览态可重试
    notice('✗ 上传失败: ' + e.message, 'error');
  }
}
// 关闭对话框：uploading 禁关闭；preview 直接关闭 = 放弃本次合成（清 IndexedDB 缓存）
async function closeMergeModal(skipCleanup, force){
  if (!force && mergeMode === 'uploading') return;   // 上传中禁关闭（确认成功强制关闭除外）
  if (!skipCleanup && (mergeMode === 'preview' || mergeMode === 'config') && mergeCtx) {
    // config/preview 直接关闭 = 放弃本次合成（清本地 full audio 缓存与元数据）
    try { await fullAudioDelete(mergeCtx.id); } catch {}
    try { localStorage.removeItem('fullmeta-' + mergeCtx.id); } catch {}
  }
  // 停止预览音频播放并释放资源
  const player = document.getElementById('mergePlayer');
  if (player) { try { player.pause(); } catch {} player.src = ''; player.load(); }
  const overlay = document.getElementById('mergeModal');
  if (overlay) overlay.style.display = 'none';
  mergeMode = 'closed';
  mergeCtx = null;
}



// SAB 可用性检测（跨域隔离）：true = 浏览器 Wasm 路径；false = 服务端合并兜底
function sabAvailable(){
  try { return typeof SharedArrayBuffer !== 'undefined' && !!new SharedArrayBuffer(4); } catch { return false; }
}

// 构造服务端拼接序列（与 Wasm 路径同语义：段 → 间隔/intro 交替）
function buildMergeSeq(segCount, gapList){
  const seq = [];
  for (let i = 0; i < segCount; i++) {
    seq.push({ t: 'seg', i: i });
    if (i < segCount - 1) {
      const ops = parseGapExpr(gapList[i]);
      ops.forEach(op => {
        if (op.t === 'gap') seq.push({ t: 'gap', sec: op.sec });
        else seq.push({ t: 'intro', url: op.url });
      });
    }
  }
  return seq;
}

// 服务端 ffmpeg 合并（SAB 不可用时）：段 base64 + 序列(+可选 bgm) → /api/run/full-merge → m4a base64
async function runServerMerge(id, si, script, audios, gapList, bgmCfg){
  const segs = script.segments;
  setMergeStep(15, '上传片段到服务端…');
  const seq = buildMergeSeq(segs.length, gapList);
  const bgm = await bgmForServer(id, bgmCfg);   // URL / file base64；无 BGM → null
  const body = { id, si, segs: audios.map(a => a && a.audio), seq, bgm };
  const d = await j('/api/run/full-merge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!(d && d.ok && d.audio)) throw new Error((d && d.error) || '服务端合成失败');
  setMergeStep(85, '服务端拼接完成，接收中…');
  const bytes = base64ToBytes(d.audio);
  const blob = new Blob([bytes.buffer], { type: d.mime || 'audio/mp4' });
  await fullAudioSave(id, blob);
  saveFullMeta(id, { at: Date.now(), size: blob.size, scriptIndex: si, segCount: segs.length, gaps: gapList, scriptName: script.title || null, bgm: bgmSummary(bgmCfg) });
  const player = document.getElementById('mergePlayer');
  if (player) player.src = URL.createObjectURL(blob);
  setMergeStep(100, '完成');
  return blob;
}
