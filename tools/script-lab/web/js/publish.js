// publish.js —— 发布卡：仅 crafted/published 显示；未发布=表单+封面+自动填充+发布；已发布=节目信息+URL
// 封面生成用 Canvas 复刻 CLI cover（color-hash 底色 + 纹理 pattern + 噪点 + 居中称呼 → 1400×1400 JPEG），与 CLI 彻底解耦

// ---------- 已发布态信息（发布成功时存 localStorage，刷新后展示） ----------
function savePubMeta(id, meta){ try { localStorage.setItem('pub-' + id, JSON.stringify(meta)); } catch {} }
function loadPubMeta(id){ try { return JSON.parse(localStorage.getItem('pub-' + id) || 'null'); } catch { return null; } }

// ---------- 发布卡渲染入口 ----------
function renderPublishCard(id, dt, rawStatus, labEnvVal, scripts){
  if (rawStatus === 'published') {
    const pm = loadPubMeta(id) || {};
    const siteBase = (typeof API_BASE !== 'undefined' && API_BASE) ? '' : '';
    const url = pm.slug ? ('/episode/' + pm.slug) : null;
    // 已发布态：展示节目信息 + 编辑入口（预览态可修改节目 meta，不影响投稿状态与关联）
    return '<div class="muted" style="font-size:12px;margin-bottom:8px">✅ 已发布</div>'
      + '<div class="detail-row"><span class="k">期号</span><span class="v">' + (pm.number ? '第 ' + esc(pm.number) + ' 期' : '—') + '</span></div>'
      + '<div class="detail-row"><span class="k">标题</span><span class="v">' + esc(pm.title || dt.title || '—') + '</span></div>'
      + (url ? '<div class="detail-row"><span class="k">详情页</span><span class="v"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></span></div>' : '')
      + (pm.episodeId ? '<div class="detail-row"><span class="k">节目 ID</span><span class="v mono">' + esc(pm.episodeId) + '</span></div>' : '')
      + '<div style="margin-top:10px"><button class="pg" onclick="togglePubEdit()" id="pubEditToggle">✏️ 编辑节目信息</button></div>'
      + '<div id="pubEditBox" style="display:none;margin-top:8px;border-top:1px solid #262b36;padding-top:10px">'
        + '<div class="muted" style="font-size:11px;margin-bottom:6px">留空 = 不修改该字段；保存后更新已发布节目</div>'
        + '<div class="pub-fields" style="gap:6px">'
          + '<textarea id="pubEditTitle" class="pub-input" rows="1" spellcheck="false" placeholder="标题（留空不改）"></textarea>'
          + '<textarea id="pubEditDesc" class="pub-input" rows="2" spellcheck="false" placeholder="描述（留空不改）"></textarea>'
          + '<select id="pubEditCat" class="pub-input"><option value="">分类（不改）</option><option value="insight">insight · 新知</option><option value="experience">experience · 经验</option><option value="advice">advice · 建议</option><option value="inspiration">inspiration · 启发</option></select>'
          + '<textarea id="pubEditTags" class="pub-input" rows="1" spellcheck="false" placeholder="标签，逗号分隔（留空不改）"></textarea>'
          + '<textarea id="pubEditSummary" class="pub-input" rows="2" spellcheck="false" placeholder="摘要（留空不改）"></textarea>'
          + '<textarea id="pubEditRefs" class="pub-input" rows="2" spellcheck="false" placeholder=&#39;引用 JSON 数组（留空不改）&#39;></textarea>'
          + '<textarea id="pubEditHl" class="pub-input" rows="1" spellcheck="false" placeholder=&#39;金句 JSON 数组（留空不改）&#39;></textarea>'
          + '<textarea id="pubEditTranscript" class="pub-input" rows="2" spellcheck="false" placeholder="完整台本（留空不改）"></textarea>'
        + '</div>'
        + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">'
          + '<button class="pg" onclick="togglePubEdit()">取消</button>'
          + '<button class="pg" style="background:#4f8cff;color:#fff;border:0" onclick="savePubMetaEdit()" id="pubEditSave">保存修改</button>'
        + '</div>'
      + '</div>';
  }
  // 未发布（crafted）：左右两列——左：节目表字段表单（统一 textarea 黑底）；右：方形封面占位 + 生成封面
  const hostName = (dt && dt.host && (dt.host.callName || (dt.host.personaInfo && dt.host.personaInfo.displayName))) || '主持人';
  const guestName = (dt && dt.guest && dt.guest.name) || '';
  const guestId = (dt && dt.guest && dt.guest.id) || null;
  try { window.__pubCoverNames = { host: hostName, guest: guestName, guestId }; } catch {}
  // 确定性数据自动携带（无输入框）：语言 = 脚本定稿语言（打磨时确定），无则 zh
  const scriptLang = (Array.isArray(scripts) && scripts[0] && scripts[0].language) || null;
  try { window.__pubLang = /^[a-z]{2,3}$/i.test(scriptLang || '') ? scriptLang.toLowerCase() : 'zh'; } catch { window.__pubLang = 'zh'; }
  const LANG_LABELS = { zh: 'zh · 中文', en: 'en · English', ja: 'ja · 日本語' };
  const langDisplay = LANG_LABELS[window.__pubLang] || window.__pubLang;
  return '<div class="pub-grid">'
    + '<div class="pub-fields">'
      + '<label class="muted" style="font-size:12px">标题</label>'
      + '<textarea id="pubTitle" class="pub-input" rows="1" spellcheck="false" placeholder="节目标题">' + esc((dt && dt.title) || '') + '</textarea>'
      + '<label class="muted" style="font-size:12px">描述</label>'
      + '<textarea id="pubDesc" class="pub-input" rows="3" spellcheck="false" placeholder="节目导读（≤200 字，吸引听众点开）"></textarea>'
      + '<label class="muted" style="font-size:12px">分类</label>'
      + '<select id="pubCat" class="pub-input"><option value="">（自动填充选择）</option><option value="insight">insight · 新知</option><option value="experience">experience · 经验</option><option value="advice">advice · 建议</option><option value="inspiration">inspiration · 启发</option></select>'
      + '<label class="muted" style="font-size:12px">标签（逗号分隔）</label>'
      + '<textarea id="pubTags" class="pub-input" rows="1" spellcheck="false" placeholder="AI, 访谈, 生活"></textarea>'
      + '<label class="muted" style="font-size:12px">摘要（列表/分享短简介）</label>'
      + '<textarea id="pubSummary" class="pub-input" rows="2" spellcheck="false" placeholder="1-2 句话补充标题（≤500 字）"></textarea>'
      + '<label class="muted" style="font-size:12px">引用/术语（JSON 数组，节目页展示）</label>'
      + '<textarea id="pubRefs" class="pub-input" rows="3" spellcheck="false" placeholder=&#39;[{"term":"术语原名","type":"类型","explanation":"一句话阐述","links":[]}]&#39;></textarea>'
      + '<label class="muted" style="font-size:12px">金句（JSON 数组，节目页「本期金句」）</label>'
      + '<textarea id="pubHl" class="pub-input" rows="2" spellcheck="false" placeholder=&#39;[{"text":"本期金句原话"}]&#39;></textarea>'
      + '<label class="muted" style="font-size:12px">完整台本（可选）</label>'
      + '<textarea id="pubTranscript" class="pub-input" rows="4" spellcheck="false" placeholder="无情绪标签的完整台词（节目页展示用）"></textarea>'
    + '</div>'
    + '<div class="pub-cover-col">'
      + '<div class="pub-cover-zone" id="pubCoverZone" onclick="document.getElementById(\'pubCoverFile\').click()">'
        + '<input type="file" id="pubCoverFile" accept="image/*" style="display:none" onchange="previewCoverFile(this)">'
        + '<img id="pubCoverPreview" class="pub-cover-img" style="display:none" alt="">'
        + '<div class="pub-cover-placeholder" id="pubCoverPlaceholder">'
          + '<div style="font-size:22px">🖼</div>'
          + '<div class="muted" style="font-size:11px">点击选择封面图片</div>'
          + '<div class="muted" style="font-size:10px">将居中裁剪为 1400×1400</div>'
        + '</div>'
      + '</div>'
      + '<button class="pg pub-cover-gen" onclick="generateCover()">🎨 生成封面</button>'
      + '<div class="muted" id="pubCoverHint" style="font-size:11px;text-align:center"></div>'
    + '</div>'
    + '</div>'
    + '<div class="muted" style="font-size:11px;margin-top:-2px">语言：<span class="mono">' + esc(langDisplay) + '</span> · 时长：<span id="pubDurVal" class="mono">检测中…</span></div>'
    + '<div class="pub-actions">'
      + '<button class="pg" onclick="autoFillMeta()" id="pubAutoBtn">✨ 自动填充</button>'
      + '<button class="pg" style="background:#4f8cff;color:#fff;border:0" onclick="publishEpisode()" id="pubSubmitBtn">🚀 发布</button>'
    + '</div>';
}

// ---------- published 态：编辑已发布节目的 meta（不影响投稿状态与关联） ----------
function togglePubEdit(){
  const box = document.getElementById('pubEditBox');
  const btn = document.getElementById('pubEditToggle');
  if (!box) return;
  const show = box.style.display === 'none';
  box.style.display = show ? 'block' : 'none';
  if (btn) btn.textContent = show ? '收起编辑' : '✏️ 编辑节目信息';
}
// 保存：只提交用户填写的字段（留空 = 不修改，服务端保留旧值）
async function savePubMetaEdit(){
  const id = (typeof currentPubId !== 'undefined') ? currentPubId : '';
  const pm = loadPubMeta(id) || {};
  const episodeId = pm.episodeId;
  if (!episodeId) { notice('缺少节目 ID（发布时未记录，请刷新）', 'error'); return; }
  const val = (elId) => { const el = document.getElementById(elId); return el ? el.value.trim() : ''; };
  const meta = {};
  const t = val('pubEditTitle'); if (t) meta.title = t;
  const d = val('pubEditDesc'); if (d) meta.description = d;
  const c = val('pubEditCat'); if (c) meta.category = c;
  const tg = val('pubEditTags'); if (tg) meta.tags = tg.split(',').map(s => s.trim()).filter(Boolean);
  const su = val('pubEditSummary'); if (su) meta.summary = su;
  const rf = val('pubEditRefs');
  if (rf) { try { const a = JSON.parse(rf); if (Array.isArray(a) && a.length) meta.references = a; else { notice('引用需为非空 JSON 数组', 'error'); return; } } catch { notice('引用 JSON 格式错误', 'error'); return; } }
  const hl = val('pubEditHl');
  if (hl) { try { const a = JSON.parse(hl); if (Array.isArray(a) && a.length) meta.highlights = a; else { notice('金句需为非空 JSON 数组', 'error'); return; } } catch { notice('金句 JSON 格式错误', 'error'); return; } }
  const tr = val('pubEditTranscript'); if (tr) meta.transcript = tr;
  if (!Object.keys(meta).length) { notice('未填写任何要修改的字段', 'error'); return; }
  const btn = document.getElementById('pubEditSave');
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
  try {
    await j('/api/run/episode-meta-update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episodeId, meta }) });
    notice('✓ 节目信息已更新', 'success');
    if (meta.title) savePubMeta(id, { ...pm, title: meta.title });
    if (typeof openDetail === 'function') openDetail(id);
  } catch (err) { notice('✗ 更新失败: ' + err.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '保存修改'; } }
}

// ---------- 封面：Canvas 生成（复刻 CLI cover） ----------
const COVER_SIZE = 1400;
const COVER_TEXTURES = ['squares', 'crosses', 'hexagons', 'woven', 'diagonal', 'zigzag'];
// 确定性哈希（color-hash 简版：seed → 0..1）
function seedHash(str){
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h / 4294967296;
}
function hslToHex2(h, s, l){
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}
// 纹理 pattern 绘制（直线几何平铺，参照 CLI）
function drawTexture(ctx, size, kind, color, cell){
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.012;
  ctx.beginPath();
  if (kind === 'squares') {
    for (let y = 0; y < size + cell; y += cell) for (let x = 0; x < size + cell; x += cell) {
      ctx.moveTo(x + cell * 0.15, y + cell * 0.15); ctx.lineTo(x + cell * 0.85, y + cell * 0.15);
      ctx.lineTo(x + cell * 0.85, y + cell * 0.85); ctx.lineTo(x + cell * 0.15, y + cell * 0.85); ctx.closePath();
    }
  } else if (kind === 'crosses') {
    for (let y = 0; y < size + cell; y += cell) for (let x = 0; x < size + cell; x += cell) {
      ctx.moveTo(x + cell * 0.2, y + cell * 0.2); ctx.lineTo(x + cell * 0.8, y + cell * 0.8);
      ctx.moveTo(x + cell * 0.8, y + cell * 0.2); ctx.lineTo(x + cell * 0.2, y + cell * 0.8);
    }
  } else if (kind === 'hexagons') {
    const r = cell * 0.32;
    for (let row = 0; row * r * 1.5 < size + r; row++) for (let col = -1; col * r * Math.sqrt(3) < size + r; col++) {
      const cx = col * r * Math.sqrt(3) + (row % 2 ? r * Math.sqrt(3) / 2 : 0);
      const cy = row * r * 1.5;
      ctx.moveTo(cx, cy - r);
      for (let a = 1; a <= 6; a++) { const ang = (Math.PI / 3) * a - Math.PI / 2; ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r); }
      ctx.closePath();
    }
  } else if (kind === 'woven') {
    for (let i = -size; i < size * 2; i += cell * 0.6) {
      ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.moveTo(i + size, 0); ctx.lineTo(i, size);
    }
  } else if (kind === 'diagonal') {
    for (let i = -size; i < size * 2; i += cell) { ctx.moveTo(i, 0); ctx.lineTo(i + size, size); }
  } else {   // zigzag
    for (let i = -size; i < size * 2; i += cell) {
      ctx.moveTo(i, 0); ctx.lineTo(i + cell * 0.5, size * 0.5); ctx.lineTo(i + cell, 0);
      ctx.moveTo(i, size); ctx.lineTo(i + cell * 0.5, size * 0.5); ctx.lineTo(i + cell, size);
    }
  }
  ctx.stroke();
  ctx.restore();
}
// 生成封面：seed=投稿id → 确定性底色+纹理；caption=居中称呼
function renderCoverCanvas(seed, hostName, guestName, textureIdx){
  const canvas = document.createElement('canvas');
  canvas.width = COVER_SIZE; canvas.height = COVER_SIZE;
  const ctx = canvas.getContext('2d');
  const r = seedHash(seed);
  // 底色（深色调，同 CLI color-hash lightness 0.18-0.38）
  const hue = Math.floor(r * 360);
  const base = hslToHex2(hue, 0.55, 0.24 + r * 0.12);
  // 渐变底色
  const grad = ctx.createLinearGradient(0, 0, COVER_SIZE, COVER_SIZE);
  grad.addColorStop(0, base);
  grad.addColorStop(1, hslToHex2((hue + 40) % 360, 0.5, 0.14));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);
  // 纹理色（高饱和候选池，色相差 ≥120° 随机）
  const strokes = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'];
  const kinds = COVER_TEXTURES[textureIdx >= 0 ? textureIdx : Math.floor(seedHash(seed + ':t') * COVER_TEXTURES.length)];
  const stroke = strokes[Math.floor(seedHash(seed + ':s') * strokes.length)];
  const cell = 140;
  drawTexture(ctx, COVER_SIZE, kinds, stroke, cell);
  // 噪点
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.04) + ')';
    ctx.fillRect(Math.random() * COVER_SIZE, Math.random() * COVER_SIZE, 1.5, 1.5);
  }
  // 居中称呼
  if (hostName || guestName) {
    const caption = (hostName ? hostName : '') + (hostName && guestName ? ' × ' : '') + (guestName ? guestName : '');
    const isDark = (parseInt(base.slice(1), 16) >> 16 & 255) + (parseInt(base.slice(1), 16) >> 8 & 255) + (parseInt(base.slice(1), 16) & 255) < 384;
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fs = 96;
    ctx.font = '600 ' + fs + 'px -apple-system, PingFang SC, sans-serif';
    while (ctx.measureText(caption).width > COVER_SIZE * 0.72 && fs > 30) {
      fs -= 4;
      ctx.font = '600 ' + fs + 'px -apple-system, PingFang SC, sans-serif';
    }
    ctx.fillText(caption, COVER_SIZE / 2, COVER_SIZE / 2);
  }
  return canvas;
}
// 生成封面 → blob → 预览（seed=投稿id；称呼从表单读）
async function generateCover(){
  const btn = document.getElementById('pubAutoBtn');
  const hint = document.getElementById('pubCoverHint');
  if (hint) hint.textContent = '生成中…';
  try {
    const id = (typeof currentPubId !== 'undefined') ? currentPubId : '';
    const names = (typeof window !== 'undefined' && window.__pubCoverNames) || {};
    const canvas = renderCoverCanvas(id || String(Date.now()), names.host || '', names.guest || '', -1);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error('封面生成失败');
    window.__pubCover = { blob, from: 'generated' };
    const img = document.getElementById('pubCoverPreview');
    const ph = document.getElementById('pubCoverPlaceholder');
    if (img) { img.src = URL.createObjectURL(blob); img.style.display = 'block'; }
    if (ph) ph.style.display = 'none';
    if (hint) hint.textContent = '已生成（' + (blob.size / 1024).toFixed(0) + 'KB）';
    notice('✓ 封面已生成', 'success');
  } catch (e) { if (hint) hint.textContent = '生成失败: ' + e.message; }
}
// 上传封面文件 → 预览（Canvas 居中裁 1400×1400）
function previewCoverFile(input){
  const file = input && input.files && input.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = COVER_SIZE; canvas.height = COVER_SIZE;
    const ctx = canvas.getContext('2d');
    const s = Math.min(img.width, img.height);
    const sx = (img.width - s) / 2, sy = (img.height - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, 0, 0, COVER_SIZE, COVER_SIZE);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    window.__pubCover = { blob, from: 'upload' };
    const pv = document.getElementById('pubCoverPreview');
    if (pv) { pv.src = URL.createObjectURL(blob); pv.style.display = 'block'; }
    const ph = document.getElementById('pubCoverPlaceholder');
    if (ph) ph.style.display = 'none';
    const hint = document.getElementById('pubCoverHint');
    if (hint) hint.textContent = '已裁剪 1400×1400（' + (blob.size / 1024).toFixed(0) + 'KB）';
  };
  img.src = URL.createObjectURL(file);
}
// 时长确定性数据：从 R2 full audio 自动检测（loadedmetadata），发布时随 meta 携带
function fmtDur(sec){
  sec = Math.round(sec);
  if (!isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return sec + ' 秒';
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? m + ' 分 ' + s + ' 秒' : m + ' 分';
}
function initPubDur(id, labEnvVal){
  return new Promise((resolve) => {
    try {
      const a = new Audio('/api/audio/full?env=' + encodeURIComponent(labEnvVal || '') + '&id=' + encodeURIComponent(id));
      a.addEventListener('loadedmetadata', () => resolve(a.duration), { once: true });
      a.addEventListener('error', () => resolve(null), { once: true });
    } catch { resolve(null); }
  }).then((d) => {
    try { window.__pubDur = (d && isFinite(d) && d > 0) ? Math.round(d) : null; } catch {}
    // 检测完成 → 直接展示实测时长
    try { const el = document.getElementById('pubDurVal'); if (el) el.textContent = fmtDur(window.__pubDur); } catch {}
  });
}

// 自动填充：脚本 → meta 提示词 → LLM → 回填表单
async function autoFillMeta(){
  const id = (typeof currentPubId !== 'undefined') ? currentPubId : '';
  if (!id) { notice('缺少投稿 id', 'error'); return; }
  const btn = document.getElementById('pubAutoBtn');
  if (btn) { btn.disabled = true; btn.textContent = '填充中…'; }
  try {
    // 原则①：meta 工作流输入从 store 取——round1 审题产物（selection）+ 打磨脚本（scripts）
    const inBody = { id, fillOnly: true };
    if (typeof getWorkflowInput === 'function') {
      try {
        const sel = getWorkflowInput(id, 'selection');
        const scr = getWorkflowInput(id, 'scripts');
        if (sel) inBody.selection = sel;
        if (Array.isArray(scr) && scr.length) inBody.script = scr[0];
      } catch {}
    }
    const d = await j('/api/run/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(inBody) });
    const r = (d && d.result) || {};
    const set = (el, v) => { const e = document.getElementById(el); if (e && v !== undefined && v !== null) e.value = v; };
    set('pubTitle', r.title || '');
    set('pubDesc', r.description || '');
    set('pubCat', r.category || '');
    set('pubTags', Array.isArray(r.tags) ? r.tags.join(', ') : '');
    // meta.system 输出的其余发布数据全字段回填（表单即唯一数据源，发布时随 meta 提交）
    set('pubSummary', r.summary || '');
    set('pubRefs', Array.isArray(r.references) && r.references.length ? JSON.stringify(r.references) : '');
    set('pubHl', Array.isArray(r.highlights) && r.highlights.length ? JSON.stringify(r.highlights) : '');
    notice('✓ 已自动填充（可继续编辑）', 'success');
  } catch (e) { notice('✗ 自动填充失败: ' + e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '✨ 自动填充'; } }
}
// 发布：FormData（cover + meta 含 audioKey）→ lab /api/run/publish-submit → api publish
async function publishEpisode(){
  const id = (typeof currentPubId !== 'undefined') ? currentPubId : '';
  if (!id) { notice('缺少投稿 id', 'error'); return; }
  const btn = document.getElementById('pubSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = '发布中…'; }
  try {
    const names = (typeof window !== 'undefined' && window.__pubCoverNames) || {};
    // 共享工作流状态：audioKey 由创作步（full audio 上传 R2）写入，发布步直接复用，免重传
    const ws = (typeof window !== 'undefined' && window.workflowState) || {};
    const fm = loadFullMeta(id) || {};
    const parseJsonArr = (el) => { if (!el) return null; const v = el.value.trim(); if (!v) return null; try { const a = JSON.parse(v); return Array.isArray(a) && a.length ? a : null; } catch { return null; } };
    const meta = {
      title: (document.getElementById('pubTitle') || {}).value || '',
      description: (document.getElementById('pubDesc') || {}).value || '',
      category: (document.getElementById('pubCat') || {}).value || '',
      language: (typeof window !== 'undefined' && window.__pubLang) || 'zh',   // 确定性数据：脚本语言自动
      tags: (document.getElementById('pubTags') || {}).value ? (document.getElementById('pubTags').value.split(',').map(s => s.trim()).filter(Boolean)) : null,
      summary: (document.getElementById('pubSummary') || {}).value || null,
      references: parseJsonArr(document.getElementById('pubRefs')),
      highlights: parseJsonArr(document.getElementById('pubHl')),
      transcript: (document.getElementById('pubTranscript') || {}).value ? document.getElementById('pubTranscript').value.trim() : null,
      durationSeconds: (typeof window !== 'undefined' && window.__pubDur) || null,   // 确定性数据：音频自动检测
      guestId: names.guestId || null,   // guests 表 id（如 deepseek/doubao）
      audioKey: ws.audioKey || fm.r2Key || ('full/' + id + '.m4a'),   // 复用已上传 R2 的成品音频
    };
    if (!meta.title) throw new Error('请填写标题');
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    if (window.__pubCover && window.__pubCover.blob) form.append('cover', window.__pubCover.blob, 'cover.jpg');
    const d = await j('/api/run/publish-submit?id=' + encodeURIComponent(id), { method: 'POST', body: form });
    if (!(d && d.ok)) throw new Error((d && d.error) || '发布失败');
    savePubMeta(id, { episodeId: d.episodeId, slug: d.slug, number: d.number, title: meta.title });
    // 素材清除时机 = 节目发布后：清浏览器素材（store/seg 缓存/full 缓存/fullmeta）——3 个 R2 产出物保留
    if (typeof clearAssets === 'function') { try { clearAssets(id); } catch {} }
    if (typeof clearSegAudioCache === 'function') { try { clearSegAudioCache(id); } catch {} }
    if (typeof fullAudioDelete === 'function') { try { await fullAudioDelete(id); } catch {} }
    try { localStorage.removeItem('fullmeta-' + id); } catch {}
    notice('✓ 已发布（第 ' + d.number + ' 期）', 'success');
    if (typeof openDetail === 'function') openDetail(id);
  } catch (e) { notice('✗ 发布失败: ' + e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '🚀 发布'; } }
}
