// 设置页：提示词是工程文件（tools/script-lab/prompts/，VSCode 编辑 + git 备份 + lab 热更新）
// 本页保留：字典文件清单展示 + LLM 配置说明 + **嘉宾管理**（身份档案 + 中英文声线）
function openDesign(){
  if (location.pathname !== '/settings') history.pushState(null, '', '/settings');
  document.getElementById('listWrap').style.display='none';
  document.getElementById('detailWrap').style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='none';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='none';
  const ld=document.getElementById('listLoading'); if(ld) ld.style.display='none';
  document.getElementById('designWrap').style.display='block';
  listPromptFiles();
}

function backToApp(){
  document.getElementById('designWrap').style.display='none';
  showList();
}

function switchSettingsTab(tab){
  document.querySelectorAll('.prompt-list .item').forEach(b => b.classList.toggle('active', b.dataset.nav === tab));
  document.getElementById('panel-prompts').style.display = tab === 'prompts' ? 'block' : 'none';
  document.getElementById('panel-llm').style.display = tab === 'llm' ? 'block' : 'none';
  const gp = document.getElementById('panel-guests');
  if (gp) gp.style.display = tab === 'guests' ? 'block' : 'none';
  if (tab === 'guests') void renderGuestAdmin();   // 进 tab 才拉数据
}

// 展示字典文件清单（读 /api/prompts/list —— lab 从工程目录列出）
async function listPromptFiles(){
  const el = document.getElementById('promptFiles');
  if (!el) return;
  try {
    const d = await j('/api/prompts/list');
    const files = (d && d.files) || [];
    el.textContent = files.length ? files.join('  ') : '（无字典文件）';
  } catch(e) {
    el.textContent = '（读取失败: ' + e.message + '）';
  }
}


// ---------- 嘉宾管理：身份档案（profiles） + 各语种声线（callName / 音频 / 转录）----------
const GUEST_LANGS = [['zh', '中文'], ['en', 'English']];

/** 设置页：打开共用的嘉宾声线弹窗（与投稿详情页同一个组件），保存后重渲染本页 */
function openGuestVoiceFor(gid, gname, lang){
  openGuestVoiceModal(gid, gname, lang, { onSaved: function(){ void renderGuestAdmin(); } });
}
const GT_INPUT = 'width:100%;box-sizing:border-box;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:6px 8px;font-size:12px';
const GT_LABEL = 'display:block;font-size:11px;color:#8a91a0;margin:8px 0 4px';

async function renderGuestAdmin(){
  const wrap = document.getElementById('guestAdmin');
  if (!wrap) return;
  wrap.textContent = '读取中…';
  let d = null;
  try { d = await j('/api/guests'); }
  catch (e) { wrap.textContent = '（读取失败：' + e.message + '）'; return; }
  const guests = (d && d.guests) || [];
  const samples = (d && d.samples) || [];
  if (!guests.length) { wrap.textContent = '（没有嘉宾）'; return; }

  wrap.innerHTML = guests.map((g) => {
    const mine = samples.filter((s) => s.guestId === g.id);
    // 声线配置走**投稿详情页那个弹窗**（openGuestVoiceModal）：这里只显示状态 + 入口
    const voiceRows = GUEST_LANGS.map(([code, name]) => {
      const row = mine.find((s) => s.language === code) || null;
      const hasAudio = !!(row && row.audioKey);
      const summary = '称呼：' + esc((row && row.callName) || '（空）')
        + ' · 转录：' + esc(((row && row.transcript) || '').slice(0, 22) || '（空）');
      return ''
        + '<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-top:1px solid #1d222c">'
        +   '<span style="width:64px;font-size:12px;color:#c9cfda">' + name + '</span>'
        +   '<span style="flex:1;font-size:11px;color:#8a91a0">'
        +     (hasAudio ? '<span style="color:#3fb950">✓ 已配置</span>' : '— 未配置')
        +     ' &nbsp;' + summary
        +   '</span>'
        +   (hasAudio ? '<button class="pg" onclick="previewGuestVoice(&quot;' + g.id + '&quot;,&quot;' + code + '&quot;)">▶ 试听</button>' : '')
        +   '<button class="pg" style="background:#4f8cff;color:#fff;border:0" onclick="openGuestVoiceFor(&quot;' + g.id + '&quot;,&quot;' + esc(g.name) + '&quot;,&quot;' + code + '&quot;)">' + (hasAudio ? '修改声线' : '配置声线') + '</button>'
        + '</div>';
    }).join('');
    const voiceBlocks = '<div style="margin-top:10px"><div class="muted" style="font-size:11px;margin-bottom:2px">声线（中英各一条；缺该语种时 TTS 回退中文）</div>' + voiceRows + '</div>';

    return ''
      + '<div class="card" style="padding:14px;margin-bottom:14px">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px">'
      +     '<b style="font-size:13px">' + esc(g.name) + ' <span class="muted" style="font-weight:400">· ' + esc(g.id) + '</span></b>'
      +     '<span class="muted" style="font-size:11px">' + esc(g.platform || '') + '</span>'
      +   '</div>'
      +   '<label style="' + GT_LABEL + '">名字（节目中显示）</label>'
      +   '<input id="gp-' + g.id + '-name" style="' + GT_INPUT + '" maxlength="50" value="' + esc(g.name) + '">'
      +   '<label style="' + GT_LABEL + '">头像（可上传图片，或直接填外链 URL）</label>'
      +   '<div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">'
      +     '<img id="gp-' + g.id + '-avatar-img" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover;background:#1a1f29;visibility:hidden">'
      +     '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
      +       '<input type="file" id="gp-' + g.id + '-avatar-file" accept="image/*" style="font-size:11px;color:#e6e8ee;max-width:190px">'
      +       '<button class="pg" onclick="uploadGuestAvatar(&quot;' + g.id + '&quot;)">上传头像</button>'
      +       '<span class="muted" id="gp-' + g.id + '-avatar-status" style="font-size:11px"></span>'
      +     '</div>'
      +   '</div>'
      +   '<input id="gp-' + g.id + '-avatar" style="' + GT_INPUT + '" maxlength="500" value="' + esc(g.avatar || '') + '" placeholder="留空 = 不设头像；上传后这里会变成 storage key">'
      +   '<label style="' + GT_LABEL + '">简介</label>'
      +   '<textarea id="gp-' + g.id + '-bio" rows="2" style="' + GT_INPUT + ';resize:vertical">' + esc(g.bio || '') + '</textarea>'
      +   '<label style="' + GT_LABEL + '">官网</label>'
      +   '<input id="gp-' + g.id + '-url" style="' + GT_INPUT + '" maxlength="500" value="' + esc(g.url || '') + '" placeholder="https://…">'
      +   '<div style="display:flex;gap:8px;align-items:center;margin-top:8px">'
      +     '<button class="pg" style="background:#4f8cff;color:#fff;border:0" onclick="saveGuestProfile(&quot;' + g.id + '&quot;)">保存档案</button>'
      +     '<span class="muted" id="gp-' + g.id + '-status" style="font-size:11px"></span>'
      +   '</div>'
      +   voiceBlocks
      + '</div>';
  }).join('');

  // 头像预览：<img> 带不了鉴权头 → 用 JS 取字节转 blob（顺带绕过缓存）
  guests.forEach((g) => { void loadGuestAvatar(g.id, g.profileId); });
}

/** 取该身份头像字节并塞进预览 <img>（静态资源需要 X-Lab-Env/Authorization，img 标签发不出） */
async function loadGuestAvatar(gid, profileId){
  const img = document.getElementById('gp-' + gid + '-avatar-img');
  if (!img) return;
  if (!profileId) { img.style.visibility = 'hidden'; return; }
  try {
    const h = {};
    if (labEnv) h['X-Lab-Env'] = labEnv;
    const tok = labEnv ? localStorage.getItem('dailog-lab-token-' + labEnv) : null;
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    const res = await fetch('/api/avatar?profileId=' + encodeURIComponent(profileId) + '&t=' + Date.now(), { headers: h });
    if (!res.ok) { img.style.visibility = 'hidden'; return; }
    const blob = await res.blob();
    if (img.dataset.blobUrl) URL.revokeObjectURL(img.dataset.blobUrl);
    const url = URL.createObjectURL(blob);
    img.dataset.blobUrl = url;
    img.src = url;
    img.style.visibility = 'visible';
  } catch { img.style.visibility = 'hidden'; }
}

const gtVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
const gtSetStatus = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

/** 保存嘉宾身份档案（profiles：name/avatar/bio/url） */
async function saveGuestProfile(gid){
  const stId = 'gp-' + gid + '-status';
  gtSetStatus(stId, '保存中…');
  try {
    await j('/api/guest-save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        guestId: gid,
        name: gtVal('gp-' + gid + '-name'),
        avatar: gtVal('gp-' + gid + '-avatar'),
        bio: gtVal('gp-' + gid + '-bio'),
        url: gtVal('gp-' + gid + '-url'),
      }),
    });
    gtSetStatus(stId, '✅ 已保存');
    notice('嘉宾档案已保存（' + gid + '）', 'success');
  } catch (e) { gtSetStatus(stId, '❌ ' + e.message); }
}

/** 上传嘉宾头像（图片 → api 归一为方图 jpeg → R2 avatars/{profileId}.jpg） */
async function uploadGuestAvatar(gid){
  const stId = 'gp-' + gid + '-avatar-status';
  const fileEl = document.getElementById('gp-' + gid + '-avatar-file');
  const file = fileEl && fileEl.files && fileEl.files[0];
  if (!file) { gtSetStatus(stId, '❌ 先选图片'); return; }
  if (file.size > 5 * 1024 * 1024) { gtSetStatus(stId, '❌ 图片超过 5MB'); return; }
  const fd = new FormData();
  fd.append('avatar', file);
  gtSetStatus(stId, '上传中…');
  try {
    await j('/api/guest-avatar?guestId=' + encodeURIComponent(gid), { method: 'POST', body: fd });
    gtSetStatus(stId, '✅ 已更新');
    notice('嘉宾头像已更新（' + gid + '）', 'success');
    void renderGuestAdmin();   // 重新拉：头像预览 + avatar 字段同步
  } catch (e) { gtSetStatus(stId, '❌ ' + e.message); }
}

/** 试听该语种声线：走通用音频代理 /api/audio/guest（<audio> 带不了鉴权头 → env 走 query） */
let guestPreviewAudio = null;
function previewGuestVoice(gid, lang){
  const url = '/api/audio/guest?env=' + encodeURIComponent(labEnv || '') + '&platform=' + encodeURIComponent(gid) + '&lang=' + encodeURIComponent(lang);
  if (guestPreviewAudio && !guestPreviewAudio.paused) { guestPreviewAudio.pause(); guestPreviewAudio = null; }
  const a = new Audio(url);
  guestPreviewAudio = a;
  a.onerror = () => { notice('试听失败：该语种没有音频，或读取失败', 'error'); guestPreviewAudio = null; };
  a.play().catch(() => { notice('试听失败：该语种没有音频，或读取失败', 'error'); guestPreviewAudio = null; });
}
