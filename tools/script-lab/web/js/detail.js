// 节目详情：投稿卡片 + 采集/创作/发布流程卡片 + 对话消息
async function openDetail(id){
  const wrap=document.getElementById('detailWrap');
  const list=document.getElementById('listWrap');
  list.style.display='none';
  const sb=document.getElementById('statbar'); if(sb) sb.style.display='none';
  const pg=document.getElementById('pager'); if(pg) pg.style.display='none';
  wrap.style.display='block';
  wrap.innerHTML='<div class="muted">加载中…</div>';
  try{
    const d=await j('/api/detail/'+id);
    const dt=d.detail||{};
    const dc=dt.dialogueCount||null;
    const collected=dt.collected;
    const rawStatus = dt.status || '?';
    const statusHtml = rawStatus==='rejected' ? `<span style='color:#f85149'>${esc(rawStatus)}</span>`
      : rawStatus==='published' ? `<span style='color:#3fb950'>${esc(rawStatus)}</span>`
      : `<span class='muted'>${esc(rawStatus)}</span>`;
    let collectStatus;
    if (fetchingIds.has(id)) collectStatus = `<span style='color:#4f8cff'><span class='spin' style='display:inline-block'></span> 采集中</span>`;
    else if (collected===1) collectStatus = dc ? `<span style='color:#3fb950'>✓ ${dc.messages} 条消息 · 共计 ${dc.chars} 字</span>` : `<span style='color:#3fb950'>✓ 已采集</span>`;
    else if (collected===-1) collectStatus = `<span style='color:#f85149'>采集失败</span>`;
    else collectStatus = `<button class='ac-act' data-fetch-id='${id}'>采集</button>`;
    const collectedOK = collected===1;
    const collectHeadClick = collectedOK ? "onclick='toggleCard(this)'" : '';
    const collectArrow = collectedOK ? `<span class='ac-arrow'>▾</span>` : '';
    const collectBodyHtml = collectedOK ? `<div class='ac-body' id='collectBody'><div class='muted'>加载中…</div></div>` : '';
    // 创作卡：仅采集成功后显示；状态与展开内容由入库的 selection 审核结果驱动
    const showPublish = rawStatus === 'published';
    const ps = d.prodSummary || null;
    const reviewStatus = ps ? ps.reviewStatus : null;
    let createStatus, createBody;
    if (reviewStatus === 'rejected') {
      createStatus = `<span style='color:#f85149'>审核被拒，对话不满足创作要求</span>`;
      createBody = `<div class='muted' style='white-space:pre-line'>拒审原因：${esc(ps.rejection || '（无）')}</div>`;
    } else if (reviewStatus === 'approved') {
      createStatus = `<span style='color:#d29922'>创作中</span>`;
      const scripts = (ps && ps.scriptList) || [];
      createBody = scripts.length
        ? scripts.map((s, si) => `<div style='margin-bottom:10px'><div class='who' style='font-size:11px;color:#d29922;margin-bottom:4px'>脚本 ${si + 1}（${(s.segments||[]).length} 段）</div>${(s.segments||[]).map(seg => `<div class='seg'><span class='who'>${esc(seg.speaker)}</span><div>${esc(seg.text)}</div></div>`).join('')}</div>`).join('')
        : `<div class='muted'>已创作，脚本列表为空</div>`;
    } else if (rawStatus === 'published') {
      // 已发布节目不再创作
      createStatus = `<span class='muted'>已发布</span>`;
      createBody = `<div class='muted'>节目已发布</div>`;
    } else {
      createStatus = `<button class='ac-act' id='btnReview' onclick='openReviewPreview("${id}")'>开始创作</button>`;
      createBody = `<div class='muted'>尚未创作——点击「开始创作」审题</div>`;
    }
    wrap.innerHTML=`
      <span class='back' onclick='showList()'>← 返回列表</span>
      <div class='ac'>
        <div class='ac-card open'>
          <div class='ac-head' onclick='toggleCard(this)'><h3 style='margin:0;font-size:14px'>投稿</h3><span class='muted mono' style='font-size:11px'>${esc(d.id)}</span><span class='ac-status'>${statusHtml}</span><span class='ac-arrow'>▾</span></div>
          <div class='ac-body'>
            <div class='detail-info'>
              <div class='detail-row'><span class='k'>标题</span><span class='v' id='subTitle'>${dt.title?esc(dt.title):'<span class="muted">加载中...</span>'}</span></div>
              <div class='detail-row'><span class='k'>投稿时间</span><span class='v'>${fmtDate(dt.createdAt)}</span></div>
              <div class='detail-row'><span class='k'>对话链接</span><span class='v'><a href='${esc(dt.url||'')}' target='_blank' rel='noopener'>${esc(dt.url||'—')}</a></span></div>
              <div class='detail-row'><span class='k'>投稿人</span><span class='v'>${esc(dt.host?.personaInfo?.displayName||'?')} · ${esc(dt.userEmail||'')}</span></div>
              <div class='detail-row'><span class='k'>称呼</span><span class='v'>${esc(dt.host?.callName||'（无，用「主持人」）')}</span></div>
              <div class='detail-row'><span class='k'>建议</span><span class='v'>${esc(dt.suggestion||'—')}</span></div>
            </div>
          </div>
        </div>
        <div class='ac-card'>
          <div class='ac-head ${collectedOK?'':'muted'}' ${collectHeadClick}><h3 style='margin:0;font-size:14px'>采集</h3><span class='ac-status'>${collectStatus}</span>${collectArrow}</div>
          ${collectBodyHtml}
        </div>
        ${collectedOK?`<div class='ac-card'>
          <div class='ac-head ${reviewStatus?'':'muted'}' ${reviewStatus?"onclick='toggleCard(this)'":''}><h3 style='margin:0;font-size:14px'>创作</h3><span class='ac-status'>${createStatus}</span>${reviewStatus?'<span class=\'ac-arrow\'>▾</span>':''}</div>
          <div class='ac-body'>${createBody}</div>
        </div>`:''}
        ${showPublish?`<div class='ac-card'>
          <div class='ac-head' onclick='toggleCard(this)'><h3 style='margin:0;font-size:14px'>发布</h3><span class='ac-status muted'>—</span><span class='ac-arrow'>▾</span></div>
          <div class="ac-body"><button class="ac-act" onclick='runStep("publish","生成元信息")'>生成元信息</button></div>
        </div>`:''}
      </div>
      ${d.progress?`<div class='card' style='margin-top:12px'><div class='muted' style='font-size:12px'>进度：${esc(d.progress.step)} · ${esc(new Date(d.progress.updatedAt).toLocaleString())}</div></div>`:''}`;
    if (collectedOK) loadCollectBody(id, dt.status==='rejected', d.dialogue);
    if (!dt.title) loadR2Title(id);
  }catch(e){
    wrap.innerHTML='<div class="err">加载失败: '+esc(e.message)+'</div>';
  }
}

async function loadR2Title(id){
  try{
    const d=await j('/api/r2title/'+id);
    const el=document.getElementById('subTitle');
    if (el) el.textContent = d.title || '(无标题)';
  }catch{
    const el=document.getElementById('subTitle');
    if (el) el.textContent='(无标题)';
  }
}

function loadCollectBody(id, rejected, dialogue){
  const el=document.getElementById('collectBody');
  if (!el) return;
  if (rejected){
    el.innerHTML='<div class="muted">投稿被拒，原始对话采集被删除</div>';
    return;
  }
  // 直接用详情页已返回的 dialogue（本页数据），不再请求 /api/draft
  if (!dialogue){ el.innerHTML='<div class="muted">无对话数据</div>'; return; }
  renderMessages(el, dialogue);
}

function renderMessages(el, data){
  const msgs=Array.isArray(data)?data:(data.messages||[]);
  el.innerHTML=msgs.map((m,i)=>`<div class='msg ${m.role==='user'?'user':'assistant'}'><input type='checkbox' class='msg-toggle' id='msg-${i}'><div class='who'>${m.role==='user'?'🧑 用户':'🤖 AI'}</div><div class='msg-body'>${esc(m.content)}</div><label for='msg-${i}' class='msg-expand show' title='展开全部'>▾</label><label for='msg-${i}' class='msg-expand hide' title='收起'>▴</label></div>`).join('')||'<div class="muted">（对话为空）</div>';
    const prevDisp = el.style.display;
    el.style.display = 'block';
    el.querySelectorAll('.msg').forEach(m => {
      const b = m.querySelector('.msg-body');
      m.classList.toggle('tall', !!(b && b.scrollHeight > b.clientHeight + 4));
    });
    el.style.display = prevDisp;
}

function toggleCard(head){
  head.parentElement.classList.toggle('open');
}

// ===== 创作审核流程（LLM 结果先不入库，drawer 展示后确认/重试）=====
let currentReview = null;
let reviewing = false;
let drawerState = null;   // 当前 drawer 状态：preview / reviewing / error / result（关闭重开时恢复）
let drawerLocked = false;   // 状态1/确认中：禁止关闭（按钮 + 遮罩点击）
function setDrawerButtons({ close, retry, confirm, confirmText, send }) {
  drawerLocked = !!close;
  const closeBtn = document.getElementById('drawerClose');
  const retryBtn = document.getElementById('btnRetry');
  const confirmBtn = document.getElementById('btnConfirm');
  const sendBtn = document.getElementById('btnSend');
  if (closeBtn) { closeBtn.disabled = close; }
  if (retryBtn) { retryBtn.style.display = retry ? '' : 'none'; retryBtn.disabled = false; }
  if (confirmBtn) { confirmBtn.style.display = confirm ? '' : 'none'; confirmBtn.disabled = false; if (confirmText) confirmBtn.textContent = confirmText; }
  if (sendBtn) { sendBtn.style.display = send ? '' : 'none'; }
}
function openDrawerOverlay(){
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawer').classList.add('open');
}
// 状态0：点击「开始创作」→ 打开 drawer 预览 LLM 输入（可编辑 system/user/温度/seed），点「发送」才调 LLM
function restoreDrawerState(){
  // 关闭重开：按当前状态恢复按钮（内容保留在 drawerBody，不重新加载）
  if (drawerState === 'preview') setDrawerButtons({ close: false, retry: false, confirm: false, send: true });
  else if (drawerState === 'reviewing') setDrawerButtons({ close: true, retry: false, confirm: false, send: false });
  else if (drawerState === 'error') setDrawerButtons({ close: false, retry: true, confirm: false, send: false });
  else if (drawerState === 'result') setDrawerButtons({ close: false, retry: true, confirm: true, confirmText: '确认', send: false });
}
async function openReviewPreview(id){
  if (reviewing) return;
  // 同投稿且已加载过 → 直接重开，恢复原状态（不重新 fetch，保留编辑内容/审核结果）
  if (currentReview && currentReview.id === id && drawerState) {
    openDrawerOverlay();
    restoreDrawerState();
    return;
  }
  reviewing = true;
  currentReview = { id, result: null, opts: null };
  drawerState = null;
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div style="padding:24px 0;text-align:center"><span class="spin" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> 加载预览...</div>';
  setDrawerButtons({ close: false, retry: false, confirm: false, send: false });
  openDrawerOverlay();
  try{
    const d = await j('/api/run/review/preview', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id})});
    showReviewPreview(d);
  }catch(e){
    body.innerHTML = '<div class="err" style="margin:8px 0">预览加载失败：' + esc(e.message) + '</div>';
    setDrawerButtons({ close: false, retry: false, confirm: false, send: false });
  }finally{ reviewing = false; }
}
function showReviewPreview(p){
  drawerState = 'preview';
  const body = document.getElementById('drawerBody');
  const ta = 'width:100%;box-sizing:border-box;height:130px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:6px;padding:8px 10px;font-size:12px;font-family:ui-monospace,Menlo,monospace;resize:vertical';
  const inp = 'width:80px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:4px;padding:4px 6px;font-size:12px';
  body.innerHTML = `
    <div style='font-size:13px;font-weight:600;margin-bottom:10px'>LLM 调用预览（可修改后发送）</div>
    <div class='muted' style='font-size:12px;margin-bottom:4px'>系统提示词</div>
    <textarea id='previewSystem' spellcheck='false' style='${ta}'>${esc(p.system)}</textarea>
    <div class='muted' style='font-size:12px;margin:10px 0 4px'>用户提示词</div>
    <textarea id='previewUser' spellcheck='false' style='${ta}'>${esc(p.user)}</textarea>
    <div style='display:flex;gap:24px;margin-top:12px;align-items:center'>
      <span class='muted' style='font-size:12px'>温度 <input id='previewTemp' type='number' step='0.1' min='0' max='2' value='${p.temperature}' style='${inp}'></span>
      <span class='muted' style='font-size:12px'>seed <input id='previewSeed' type='number' value='${p.seed ?? ''}' style='width:110px;background:#0b0d11;border:1px solid #262b36;color:#e6e8ee;border-radius:4px;padding:4px 6px;font-size:12px'></span>
    </div>
  `;
  setDrawerButtons({ close: false, retry: false, confirm: false, send: true });
}
function sendReview(){
  if (!currentReview) return;
  const id = currentReview.id;
  const system = document.getElementById('previewSystem').value;
  const user = document.getElementById('previewUser').value;
  const temperature = document.getElementById('previewTemp').value;
  const seed = document.getElementById('previewSeed').value;
  startReview(id, { system, user, temperature, seed });
}
async function startReview(id, opts = {}){
  if (reviewing) return;
  reviewing = true;
  currentReview.opts = opts;
  drawerState = 'reviewing';
  // 状态1：LLM审题中...（禁关闭，隐藏 重试/确认/发送）
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div style="padding:24px 0;text-align:center"><span class="spin" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> LLM审题中...</div>';
  setDrawerButtons({ close: true, retry: false, confirm: false, send: false });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 100000);   // LLM 审题超时兜底（100s）→ 状态2
  try{
    const d = await j('/api/run/review', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id, ...opts}), signal: ac.signal});
    currentReview = { id, result: d.result, usage: d.usage || null, opts };
    showReviewDrawer(d.result, d.usage || null);   // 状态3：展示结果 + 重试/确认
  }catch(e){
    if (ac.signal.aborted) showReviewError('LLM 审题超时（100s），请重试');
    else showReviewError(e.message);   // 状态2：错误原因 + 重试
  }finally{
    clearTimeout(timer);
    reviewing = false;
  }
}
function showReviewDrawer(result, usage){
  drawerState = 'result';
  const body = document.getElementById('drawerBody');
  // 底部显示 LLM token 消耗
  const usageEl = document.getElementById('drawerUsage');
  if (usageEl) usageEl.textContent = usage ? ('输入 ' + usage.input + ' toks / 输出 ' + usage.output + ' toks') : '';
  const statusHtml = result.rejected
    ? `<span style='color:#f85149'>✗ 审核不通过（得分 ${result.score ?? '?'}）</span>`
    : `<span style='color:#3fb950'>✓ 审核通过（得分 ${result.score ?? '?'}）</span>`;
  const scoreDetail = Array.isArray(result['score-detail']) ? result['score-detail'] : [];
  // 脚本内容（.msg 样式；speaker=host → callName，speaker=guest → guestName）
  const scripts = !result.rejected && Array.isArray(result.scripts) ? result.scripts : [];
  const scriptsHtml = scripts.map((s, si) => {
    const segs = Array.isArray(s.segments) ? s.segments : [];
    const callName = s.host || '主持人';
    const guestName = s.guest || 'AI';
    return `<div style='margin-bottom:12px'><div class='who' style='font-size:11px;color:#d29922;margin-bottom:6px'>脚本 ${si + 1}</div>`
      + segs.map((seg, i) => `<div class='msg ${seg.speaker === 'guest' ? 'assistant' : 'user'}'><input type='checkbox' class='msg-toggle' id='scr-${si}-${i}'><div class='who'>${seg.speaker === 'guest' ? esc(guestName) : esc(callName)}</div><div class='msg-body'>${esc(seg.text)}</div><label for='scr-${si}-${i}' class='msg-expand show' title='展开全部'>▾</label><label for='scr-${si}-${i}' class='msg-expand hide' title='收起'>▴</label></div>`).join('')
      + '</div>';
  }).join('');
  body.innerHTML = `
    <div style='margin-bottom:12px;font-size:14px'>${statusHtml}</div>
    ${scoreDetail.length ? `<div style='margin-bottom:12px'><div style='font-size:13px;font-weight:600;margin-bottom:4px'>得分详情</div>${scoreDetail.map(sd => `<div style='display:flex;gap:8px;margin-bottom:12px'><span style='color:#8a91a0;font-size:12px;min-width:76px'>${esc(sd.dimension || '')}</span><span style='font-size:13px'><b>${sd.score ?? '—'}</b><span style='color:#8a91a0;font-size:11px'>（权重 ${sd.weight ?? '—'}）</span><div style='color:#8a91a0;font-size:12px;margin-top:2px'>${esc(sd.comment || '')}</div></span></div>`).join('')}</div>` : ''}
    <div class='detail-row'><span class='k'>标题</span><span class='v'>${esc(result.title || '—')}</span></div>
    <div class='detail-row'><span class='k'>主线</span><span class='v'>${esc(result.main_topic || '—')}</span></div>
    <div class='detail-row'><span class='k'>分类</span><span class='v'>${esc(result.category || '—')}</span></div>
    <div class='detail-row'><span class='k'>脚本</span><span class='v'>${(result.scripts||[]).length} 个${result.rejected ? '' : '（确认后进入创作）'}</span></div>
    ${scriptsHtml}
    ${result.rejected ? `<div class='detail-row'><span class='k'>拒审原因</span><span class='v' style='white-space:pre-line'>${esc(result.rejection || '—')}</span></div>` : ''}
    ${result.advice ? `<div class='detail-row'><span class='k'>建议</span><span class='v'>${esc(result.advice)}</span></div>` : ''}
  `;
  // 脚本消息超长折叠检测（同采集卡片 .msg 逻辑）
  requestAnimationFrame(() => {
    body.querySelectorAll('.msg').forEach(m => {
      const b = m.querySelector('.msg-body');
      m.classList.toggle('tall', !!(b && b.scrollHeight > b.clientHeight + 4));
    });
  });
  setDrawerButtons({ close: false, retry: true, confirm: true, confirmText: '确认' });
}
function showReviewError(msg){
  drawerState = 'error';
  const body = document.getElementById('drawerBody');
  body.innerHTML = '<div class="err" style="margin:8px 0">审题失败：' + esc(msg) + '</div>';
  setDrawerButtons({ close: false, retry: true, confirm: false });
}
function closeReviewDrawer(){
  if (drawerLocked) return;   // 状态1/确认中禁止关闭
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawer').classList.remove('open');
}
async function confirmReview(){
  if (!currentReview) return;
  const id = currentReview.id;
  // 不关 drawer：锁定关闭 + 禁用 重试/确认，确认按钮显示"确认中...."
  drawerLocked = true;
  const retryBtn = document.getElementById('btnRetry');
  const confirmBtn = document.getElementById('btnConfirm');
  if (retryBtn) retryBtn.disabled = true;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '确认中....'; }
  try{
    // 审题结果随确认请求传回（不依赖 server 内存）
    await j('/api/run/review/confirm', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({id, result: currentReview.result})});
    currentReview = null;
    drawerLocked = false;
    closeReviewDrawer();
    openDetail(id);
  }catch(e){
    // 失败：解锁 + 恢复按钮
    drawerLocked = false;
    if (retryBtn) retryBtn.disabled = false;
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '确认'; }
    alert(e.message);
  }
}
function retryReview(){
  if (!currentReview) return;
  // 不关 drawer，用原输入重新审题（进入状态1）
  startReview(currentReview.id, currentReview.opts || {});
}

async function runStep(step,label){
  const id=location.pathname.slice(1);
  const st=document.getElementById('stepStatus');
  if(!st) return;
  st.textContent=label+' 执行中…';
  try{
    const d=await j('/api/run/'+step,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});
    st.textContent=(d.message||label+' 完成')+(d.detail?' — '+d.detail:'');
    setTimeout(()=>openDetail(id), 800);
  }catch(e){st.textContent='❌ '+e.message}
}
