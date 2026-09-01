// merge.js —— 语音合成（浏览器端 ffmpeg.wasm）：把已生成的各段 audio 拼接为完整 m4a
// 段间间隔以「气泡表达式」配置（一行小字，点击可编辑）：
//   仅间隔：[0.5s]
//   穿插外部音频：[0.5s]+[https://example.com/a.mp3]+[0.2s]
//   解析失败 fallback：[0s]
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



// ---------- 音频合成对话框（loading → preview → uploading） ----------
let mergeCtx = null;        // { id, si }
let mergeMode = 'closed';   // closed | loading | preview | uploading

function setMergeMode(mode){
  mergeMode = mode;
  const title = document.getElementById('mergeTitle');
  const closeBtn = document.getElementById('mergeCloseBtn');
  const loading = document.getElementById('mergeLoading');
  const preview = document.getElementById('mergePreview');
  const confirmBtn = document.getElementById('mergeConfirmBtn');
  const remergeBtn = document.getElementById('mergeRemergeBtn');
  if (mode === 'loading') {
    if (title) title.textContent = '音频合成中…';
    if (closeBtn) closeBtn.style.display = 'none';          // 禁止关闭
    if (loading) loading.style.display = 'block';
    if (preview) preview.style.display = 'none';
  } else if (mode === 'preview') {
    if (title) title.textContent = '音频已合成';
    if (closeBtn) closeBtn.style.display = '';              // 可关闭
    if (loading) loading.style.display = 'none';
    if (preview) preview.style.display = 'block';
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    if (remergeBtn) remergeBtn.disabled = false;
  } else if (mode === 'uploading') {
    if (title) title.textContent = '正在上传…';
    if (closeBtn) closeBtn.style.display = 'none';          // 禁止关闭
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

// 合成主体（对话框模式）：收集段音频 → ffmpeg 拼接 → IndexedDB 暂存 → 返回 blob
async function runMergeConcat(){
  const { id, si } = mergeCtx;
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
    return runServerMerge(id, si, script, audios, gapList);
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
  setMergeStep(75, '拼接编码中…');
  ffmpeg.FS('writeFile', '_list.txt', new TextEncoder().encode(listLines.join('\n')));
  await ffmpeg.run('-y', '-f', 'concat', '-safe', '0', '-i', '_list.txt', '-c:a', 'aac', '-b:a', '128k', 'final.m4a');
  setMergeStep(92, '生成成品…');
  const out = ffmpeg.FS('readFile', 'final.m4a');
  if (!out || !out.length) throw new Error('合成结果为空');
  const blob = new Blob([out.buffer], { type: 'audio/mp4' });
  await fullAudioSave(id, blob);
  saveFullMeta(id, { at: Date.now(), size: blob.size, scriptIndex: si, segCount: segs.length, gaps: gapList, scriptName: script.title || null });
  const player = document.getElementById('mergePlayer');
  if (player) player.src = URL.createObjectURL(blob);
  return blob;
}

// 打开合成对话框并开始合成（合成按钮入口）
async function openMergeDialog(id, si){
  if (mergeMode !== 'closed') return;
  mergeCtx = { id, si };
  // 停止预览音频播放并释放资源
  const player = document.getElementById('mergePlayer');
  if (player) { try { player.pause(); } catch {} player.src = ''; player.load(); }
  const overlay = document.getElementById('mergeModal');
  if (overlay) overlay.style.display = 'flex';
  setMergeMode('loading');
  try {
    await runMergeConcat();
    setMergeMode('preview');
  } catch (e) {
    closeMergeModal(true, true);   // 确认成功：强制关闭
    notice('✗ 语音合成失败: ' + e.message, 'error');
  }
}
// 预览态：重新合成
async function remergeAudio(){
  if (mergeMode !== 'preview') return;
  setMergeMode('loading');
  try {
    await runMergeConcat();
    setMergeMode('preview');
  } catch (e) {
    closeMergeModal(true, true);   // 确认成功：强制关闭
    notice('✗ 语音合成失败: ' + e.message, 'error');
  }
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
  if (!skipCleanup && mergeMode === 'preview' && mergeCtx) {
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

// 服务端 ffmpeg 合并（SAB 不可用时）：段 base64 + 序列 → /api/run/full-merge → m4a base64
async function runServerMerge(id, si, script, audios, gapList){
  const segs = script.segments;
  setMergeStep(15, '上传片段到服务端…');
  const seq = buildMergeSeq(segs.length, gapList);
  const body = { id, si, segs: audios.map(a => a && a.audio), seq };
  const d = await j('/api/run/full-merge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!(d && d.ok && d.audio)) throw new Error((d && d.error) || '服务端合成失败');
  setMergeStep(85, '服务端拼接完成，接收中…');
  const bytes = base64ToBytes(d.audio);
  const blob = new Blob([bytes.buffer], { type: d.mime || 'audio/mp4' });
  await fullAudioSave(id, blob);
  saveFullMeta(id, { at: Date.now(), size: blob.size, scriptIndex: si, segCount: segs.length, gaps: gapList, scriptName: script.title || null });
  const player = document.getElementById('mergePlayer');
  if (player) player.src = URL.createObjectURL(blob);
  setMergeStep(100, '完成');
  return blob;
}
